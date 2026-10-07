/**
 * Telegram Bot Webhook Receiver
 * MPC-7254: Listen for privacy scan requests, help commands, and direct questions
 * 
 * Route: POST /webhooks/telegram
 * Auth: Telegram Bot Token validation (via webhook path token verification)
 * 
 * Flow:
 * 1. Validate webhook signature (bot token in URL path)
 * 2. Parse incoming message, command, or callback query
 * 3. Filter for /scan, /help, /start, or free-text privacy questions
 * 4. Extract metadata (user_id, chat_id, message_id, text, timestamp)
 * 5. Forward to Supabase Edge Function (MPC-8302 template engine)
 * 6. Log structured event to Cloud Logging
 * 7. Return 200 OK immediately (async processing)
 * 
 * Note: Telegram webhooks require HTTPS. Deploy behind Cloudflare (automatic HTTPS).
 */

// Environment variables (from Secret Manager)
const TELEGRAM_BOT_TOKEN = env.TELEGRAM_BOT_TOKEN;
const TELEGRAM_BOT_WEBHOOK_SECRET = env.TELEGRAM_BOT_WEBHOOK_SECRET;
const SUPABASE_EDGE_FUNCTION_URL = env.SUPABASE_EDGE_FUNCTION_URL;
const CLOUD_LOGGING_ENDPOINT = env.CLOUD_LOGGING_ENDPOINT;

// Supported commands
const COMMANDS = {
  START: '/start',
  SCAN: '/scan',
  HELP: '/help',
  REMOVE: '/remove',
  STATUS: '/status',
};

// Privacy-related keywords
const PRIVACY_KEYWORDS = [
  'privacy',
  'data exposed',
  'breach',
  'exposure',
  'remove my data',
  'find me online',
  'where is my data',
  'data broker',
];

/**
 * Validate Telegram webhook signature
 * Telegram includes the bot token in the webhook URL path; we verify it here
 */
function validateTelegramSignature(url, botToken) {
  const pathSegments = new URL(url).pathname.split('/');
  const webhookToken = pathSegments[pathSegments.length - 1];

  // Webhook token should match bot token (or a derived hash)
  // For security, compare with bot token or a pre-hashed secret
  return webhookToken === botToken || webhookToken === TELEGRAM_BOT_WEBHOOK_SECRET;
}

/**
 * Determine if message is relevant to privacy scanning
 */
function isRelevantMessage(message) {
  if (!message || !message.text) return false;

  const text = message.text.toLowerCase();

  // Check for commands
  for (const cmd of Object.values(COMMANDS)) {
    if (text.startsWith(cmd)) return true;
  }

  // Check for privacy keywords
  const hasPrivacyKeyword = PRIVACY_KEYWORDS.some((kw) => text.includes(kw));
  if (hasPrivacyKeyword) return true;

  return false;
}

/**
 * Extract message metadata
 */
function extractMessageMetadata(message, from, chat) {
  const text = message.text || '';
  const command = text.split(' ')[0];

  return {
    platform: 'telegram',
    event_type: detectEventType(text),
    message_id: message.message_id,
    user_id: from.id,
    username: from.username || `user_${from.id}`,
    first_name: from.first_name,
    last_name: from.last_name || '',
    chat_id: chat.id,
    chat_type: chat.type, // private, group, supergroup, channel
    text: text,
    command: detectCommand(text),
    created_at: new Date(message.date * 1000).toISOString(),
    is_group: chat.type !== 'private',
  };
}

/**
 * Detect event type from message content
 */
function detectEventType(text) {
  if (text.startsWith('/')) return 'command';
  if (text.toLowerCase().includes('privacy') || text.toLowerCase().includes('data'))
    return 'privacy_question';
  return 'general_message';
}

/**
 * Detect command from message text
 */
function detectCommand(text) {
  const commands = ['/start', '/scan', '/help', '/remove', '/status'];
  for (const cmd of commands) {
    if (text.startsWith(cmd)) return cmd;
  }
  return null;
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
    message: `Telegram webhook event: ${metadata.event_type}`,
    jsonPayload: {
      platform: 'telegram',
      message_id: metadata.message_id,
      user_id: metadata.user_id,
      username: metadata.username,
      chat_id: metadata.chat_id,
      chat_type: metadata.chat_type,
      text: metadata.text,
      command: metadata.command,
      forwarded_to_edge_function: result.success,
      edge_function_status: result.status || null,
      is_group: metadata.is_group,
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
 * Handle rate limiting with exponential backoff
 * Store rate limit state in Cloudflare KV
 */
async function checkRateLimit(userId, env) {
  const key = `rate_limit:telegram:${userId}`;
  const current = await env.RATE_LIMIT_KV.get(key);

  if (!current) {
    // First request in window
    await env.RATE_LIMIT_KV.put(key, '1', { expirationTtl: 60 }); // 1 req per minute
    return true;
  }

  const count = parseInt(current);
  if (count >= 10) {
    // Max 10 requests per minute
    return false;
  }

  await env.RATE_LIMIT_KV.put(key, (count + 1).toString(), { expirationTtl: 60 });
  return true;
}

/**
 * Main handler: POST /webhooks/telegram
 */
export async function handleTelegramWebhook(request, env) {
  // Only accept POST
  if (request.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 });
  }

  // Validate webhook signature
  const url = new URL(request.url);
  if (!validateTelegramSignature(url.href, TELEGRAM_BOT_TOKEN)) {
    return new Response('Webhook signature invalid', { status: 401 });
  }

  let update;
  try {
    update = await request.json();
  } catch (error) {
    return new Response('Invalid JSON', { status: 400 });
  }

  // Handle different update types
  if (update.message) {
    const { message, from, chat } = {
      message: update.message,
      from: update.message.from,
      chat: update.message.chat,
    };

    // Rate limit check
    const allowed = await checkRateLimit(from.id, env);
    if (!allowed) {
      console.warn(`Rate limit exceeded for user ${from.id}`);
      return new Response(JSON.stringify({ success: false, rate_limited: true }), {
        status: 429,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // Filter for relevance
    if (!isRelevantMessage(message)) {
      return new Response(JSON.stringify({ success: true, skipped: true }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // Extract metadata
    const metadata = extractMessageMetadata(message, from, chat);

    // Forward to template engine
    const result = await forwardToTemplateEngine(metadata);

    // Log event
    await logToCloudLogging(metadata, result);

    return new Response(JSON.stringify({ success: result.success }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  if (update.callback_query) {
    const { callback_query, from } = {
      callback_query: update.callback_query,
      from: update.callback_query.from,
    };

    const metadata = {
      platform: 'telegram',
      event_type: 'callback_query',
      query_id: callback_query.id,
      user_id: from.id,
      username: from.username || `user_${from.id}`,
      data: callback_query.data,
      created_at: new Date().toISOString(),
    };

    const result = await forwardToTemplateEngine(metadata);
    await logToCloudLogging(metadata, result);

    return new Response(JSON.stringify({ success: result.success }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // Unknown update type
  return new Response(JSON.stringify({ success: true, skipped: true }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

export default handleTelegramWebhook;
