/**
 * X (Twitter) Webhook Receiver
 * MPC-7254: Listen for MyPrivacyTOOL brand mentions and privacy-related queries
 * 
 * Route: POST /webhooks/x
 * Auth: Bearer token (X API v2 OAuth)
 * 
 * Flow:
 * 1. Validate webhook signature (X CRC token)
 * 2. Parse incoming tweet event
 * 3. Filter for brand mentions, hashtags, and privacy keywords
 * 4. Extract metadata (user_id, tweet_id, text, timestamp, author)
 * 5. Forward to Supabase Edge Function (MPC-8302 template engine)
 * 6. Log structured event to Cloud Logging
 * 7. Return 200 OK immediately (async processing)
 */

import crypto from 'crypto';

// Environment variables (from Secret Manager)
const X_BEARER_TOKEN = env.X_BEARER_TOKEN;
const X_CONSUMER_KEY = env.X_CONSUMER_KEY;
const X_CONSUMER_SECRET = env.X_CONSUMER_SECRET;
const X_ACCESS_TOKEN = env.X_ACCESS_TOKEN;
const X_ACCESS_TOKEN_SECRET = env.X_ACCESS_TOKEN_SECRET;
const SUPABASE_EDGE_FUNCTION_URL = env.SUPABASE_EDGE_FUNCTION_URL;
const CLOUD_LOGGING_ENDPOINT = env.CLOUD_LOGGING_ENDPOINT;

// Brand keywords and hashtags to monitor
const BRAND_KEYWORDS = [
  'myprivacytool',
  'privacy tool',
  'data broker',
  'exposure score',
  'privacy scan',
];

const PRIVACY_KEYWORDS = [
  'data exposed',
  'data breach',
  'privacy leak',
  'personal data',
  'remove my data',
];

const HASHTAGS = ['#privacy', '#cybersecurity', '#dataprivacy', '#gdpr', '#ccpa'];

/**
 * Validate X webhook CRC token
 * X sends a CRC challenge during setup; we must echo back the HMAC-SHA256
 */
function validateCRCToken(req, consumerSecret) {
  const crcToken = req.query.crc_token;
  if (!crcToken) return null;

  const hmac = crypto
    .createHmac('sha256', consumerSecret)
    .update(crcToken)
    .digest('base64');

  return {
    response_token: `sha256=${hmac}`,
  };
}

/**
 * Validate webhook signature
 * X signs each POST with X-Twitter-Webhooks-Signature header
 */
function validateWebhookSignature(body, signature, consumerSecret) {
  const hmac = crypto
    .createHmac('sha256', consumerSecret)
    .update(body)
    .digest('base64');

  const expectedSignature = `sha256=${hmac}`;
  return crypto.timingSafeEqual(
    Buffer.from(signature),
    Buffer.from(expectedSignature)
  );
}

/**
 * Filter tweet for relevance
 * Returns true if tweet mentions brand, privacy keywords, or relevant hashtags
 */
function isRelevantTweet(tweet) {
  const text = tweet.text.toLowerCase();

  // Check for brand keywords
  const hasBrand = BRAND_KEYWORDS.some((kw) => text.includes(kw.toLowerCase()));
  if (hasBrand) return true;

  // Check for privacy keywords
  const hasPrivacy = PRIVACY_KEYWORDS.some((kw) =>
    text.includes(kw.toLowerCase())
  );
  if (hasPrivacy) return true;

  // Check for relevant hashtags
  if (tweet.entities?.hashtags) {
    const hasRelevantHashtag = tweet.entities.hashtags.some((ht) =>
      HASHTAGS.includes(`#${ht.tag.toLowerCase()}`)
    );
    if (hasRelevantHashtag) return true;
  }

  return false;
}

/**
 * Extract relevant metadata from tweet
 */
function extractTweetMetadata(tweet, author) {
  return {
    platform: 'x',
    event_type: 'mention',
    tweet_id: tweet.id,
    user_id: author.id,
    username: author.username,
    author_name: author.name,
    text: tweet.text,
    created_at: tweet.created_at,
    public_metrics: tweet.public_metrics || {
      like_count: 0,
      reply_count: 0,
      retweet_count: 0,
    },
    is_reply: !!tweet.in_reply_to_user_id,
    is_quote: !!tweet.quote_status_id,
  };
}

/**
 * Forward to Supabase Edge Function for processing
 */
async function forwardToTemplateEngine(metadata) {
  try {
    const response = await fetch(SUPABASE_EDGE_FUNCTION_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${env.SUPABASE_SERVICE_KEY}`,
      },
      body: JSON.stringify(metadata),
    });

    return {
      success: response.ok,
      status: response.status,
      timestamp: new Date().toISOString(),
    };
  } catch (error) {
    return {
      success: false,
      error: error.message,
      timestamp: new Date().toISOString(),
    };
  }
}

/**
 * Log structured event to Cloud Logging
 */
async function logToCloudLogging(metadata, result) {
  const logEntry = {
    severity: result.success ? 'INFO' : 'WARNING',
    message: `X webhook event: ${metadata.event_type}`,
    jsonPayload: {
      platform: 'x',
      tweet_id: metadata.tweet_id,
      user_id: metadata.user_id,
      username: metadata.username,
      text: metadata.text,
      forwarded_to_edge_function: result.success,
      edge_function_status: result.status || null,
      latency_ms: new Date().getTime() - new Date(metadata.created_at).getTime(),
      timestamp: new Date().toISOString(),
    },
  };

  try {
    await fetch(CLOUD_LOGGING_ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${env.GCP_CLOUD_LOGGING_TOKEN}`,
      },
      body: JSON.stringify(logEntry),
    });
  } catch (error) {
    console.error('Cloud Logging error:', error);
  }
}

/**
 * Refresh X OAuth token (90-day rotation)
 * Called by a scheduled task or on-demand
 */
async function refreshXAccessToken() {
  try {
    const response = await fetch('https://api.twitter.com/2/oauth2/token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: env.X_REFRESH_TOKEN,
        client_id: X_CONSUMER_KEY,
        client_secret: X_CONSUMER_SECRET,
      }),
    });

    if (!response.ok) {
      throw new Error(`Token refresh failed: ${response.status}`);
    }

    const data = await response.json();

    // Store new token in Secret Manager (via Admin API)
    await fetch(`${env.SECRET_MANAGER_ENDPOINT}/x-access-token`, {
      method: 'PUT',
      headers: {
        Authorization: `Bearer ${env.SECRET_MANAGER_TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        value: data.access_token,
        rotated_at: new Date().toISOString(),
      }),
    });

    return {
      success: true,
      expires_at: new Date(Date.now() + data.expires_in * 1000).toISOString(),
    };
  } catch (error) {
    console.error('Token refresh error:', error);
    return { success: false, error: error.message };
  }
}

/**
 * Main handler: POST /webhooks/x
 */
export async function handleXWebhook(request) {
  // CRC token validation (one-time setup)
  if (request.method === 'GET') {
    const crcResponse = validateCRCToken(
      new URL(request.url),
      X_CONSUMER_SECRET
    );
    if (crcResponse) {
      return new Response(JSON.stringify(crcResponse), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    return new Response('CRC token validation failed', { status: 400 });
  }

  // Validate webhook signature
  if (request.method === 'POST') {
    const signature = request.headers.get(
      'x-twitter-webhooks-signature'
    );
    const body = await request.text();

    try {
      if (!validateWebhookSignature(body, signature, X_CONSUMER_SECRET)) {
        return new Response('Webhook signature invalid', { status: 401 });
      }
    } catch (error) {
      return new Response('Signature validation error', { status: 400 });
    }

    const event = JSON.parse(body);

    // Process tweet_create_events
    if (event.tweet_create_events) {
      for (const tweet of event.tweet_create_events) {
        // Get author info (requires additional API call for full user object)
        // For now, use tweet author_id from the event
        if (!isRelevantTweet(tweet)) continue;

        const metadata = extractTweetMetadata(tweet, {
          id: tweet.user_id || tweet.author_id,
          username: tweet.username || 'unknown',
          name: tweet.author_name || 'Unknown User',
        });

        // Forward to template engine
        const result = await forwardToTemplateEngine(metadata);

        // Log event
        await logToCloudLogging(metadata, result);
      }
    }

    return new Response(JSON.stringify({ success: true, processed: true }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  return new Response('Method not allowed', { status: 405 });
}

export default handleXWebhook;
