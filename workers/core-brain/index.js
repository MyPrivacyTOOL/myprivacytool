/**
 * MyPrivacyTOOL — Core Brain Orchestrator
 * Cloudflare Worker (MPC-8601)
 *
 * Central routing and orchestration layer for the social bot.
 * Routes payloads from social platforms through intent recognition,
 * risk assessment, and response formatting.
 *
 * Deploy:
 *   wrangler deploy workers/core-brain/index.js
 *
 * Env vars needed (Cloudflare Dashboard → Workers → Settings → Variables):
 *   SUPABASE_URL            — Supabase project URL
 *   SUPABASE_SERVICE_KEY    — Supabase service role key (not anon)
 *   QWEN_API_KEY            — Qwen API key (Alibaba Cloud or compatible)
 *   QWEN_MODEL              — Model name (e.g. qwen-7b-chat, qwen-turbo)
 *   WEBHOOK_SECRET          — Shared secret for inbound webhook verification
 *   X_API_KEY               — X (Twitter) API bearer token
 *   TELEGRAM_BOT_TOKEN      — Telegram Bot token
 *
 * KV namespace:
 *   CORE_BRAIN_KV           — Rate limiting, conversation state caching
 */

// Constants
const INTENT_LABELS = {
  query_scan: "query_scan",
  get_help: "get_help",
  opt_in: "opt_in",
  opt_out: "opt_out",
  feedback: "feedback",
  unknown: "unknown",
};

const ENTITY_PATTERNS = {
  email: /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/gi,
  phone: /\b(?:\+?1[-.]?)?\(?([0-9]{3})\)?[-.]?([0-9]{3})[-.]?([0-9]{4})\b/g,
  handle: /@([a-zA-Z0-9_]{1,15})/g,
  domain: /(?:https?:\/\/)?(?:www\.)?([a-z0-9-]+\.[a-z]{2,})/gi,
};

// Utility: constant-time comparison for secrets
function constantTimeEqual(a, b) {
  let diff = a.length ^ b.length;
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    diff |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  }
  return diff === 0;
}

// Utility: extract entities using regex patterns
function extractEntities(text) {
  const entities = {};
  for (const [type, pattern] of Object.entries(ENTITY_PATTERNS)) {
    const matches = text.match(pattern) || [];
    if (matches.length > 0) {
      entities[type] = matches;
    }
  }
  return entities;
}

// Supabase: Query user state from user_state table
async function queryUserState(supabaseUrl, serviceKey, senderId) {
  try {
    const url = `${supabaseUrl}/rest/v1/user_state?sender_id=eq.${encodeURIComponent(senderId)}`;
    const res = await fetch(url, {
      method: "GET",
      headers: {
        "Authorization": `Bearer ${serviceKey}`,
        "apikey": serviceKey,
      },
    });
    if (!res.ok) {
      console.error(`queryUserState failed: ${res.status} ${res.statusText}`);
      return null;
    }
    const rows = await res.json();
    return rows.length > 0 ? rows[0] : null;
  } catch (err) {
    console.error(`queryUserState exception: ${err.message}`);
    return null;
  }
}

// Supabase: Query localization template by language code
async function queryLocalization(supabaseUrl, serviceKey, languageCode) {
  try {
    const url = `${supabaseUrl}/rest/v1/localization?language_code=eq.${encodeURIComponent(languageCode)}`;
    const res = await fetch(url, {
      method: "GET",
      headers: {
        "Authorization": `Bearer ${serviceKey}`,
        "apikey": serviceKey,
      },
    });
    if (!res.ok) {
      console.error(`queryLocalization failed: ${res.status} ${res.statusText}`);
      return null;
    }
    const rows = await res.json();
    return rows.length > 0 ? rows[0] : null;
  } catch (err) {
    console.error(`queryLocalization exception: ${err.message}`);
    return null;
  }
}

// Supabase: Fetch next message from social_inbound_queue (FIFO)
async function consumeQueueMessage(supabaseUrl, serviceKey) {
  try {
    // Fetch one unprocessed message, ordered by created_at
    const url = `${supabaseUrl}/rest/v1/social_inbound_queue?is_processed=eq.false&order=created_at.asc&limit=1`;
    const res = await fetch(url, {
      method: "GET",
      headers: {
        "Authorization": `Bearer ${serviceKey}`,
        "apikey": serviceKey,
      },
    });
    if (!res.ok) {
      console.error(`consumeQueueMessage failed: ${res.status} ${res.statusText}`);
      return null;
    }
    const rows = await res.json();
    return rows.length > 0 ? rows[0] : null;
  } catch (err) {
    console.error(`consumeQueueMessage exception: ${err.message}`);
    return null;
  }
}

// Supabase: Mark queue message as processed
async function markQueueMessageProcessed(supabaseUrl, serviceKey, queueId) {
  try {
    const url = `${supabaseUrl}/rest/v1/social_inbound_queue?id=eq.${queueId}`;
    const res = await fetch(url, {
      method: "PATCH",
      headers: {
        "Authorization": `Bearer ${serviceKey}`,
        "apikey": serviceKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ is_processed: true, processed_at: new Date().toISOString() }),
    });
    if (!res.ok) {
      console.error(`markQueueMessageProcessed failed: ${res.status} ${res.statusText}`);
      return false;
    }
    return true;
  } catch (err) {
    console.error(`markQueueMessageProcessed exception: ${err.message}`);
    return false;
  }
}

// Qwen: Call intent classification and entity recognition
async function classifyIntentQwen(qwenApiKey, qwenModel, messageText) {
  const systemPrompt = `You are a privacy assistant classifier. Analyze the user message and respond with JSON: {"intent": "<one of: query_scan, get_help, opt_in, opt_out, feedback, unknown>", "confidence": <0-1>, "extracted_text": "<key phrases or entities>"}`;
  
  try {
    // NOTE: This assumes a Qwen-compatible API endpoint. Adjust based on actual Qwen service.
    // If using Alibaba Cloud, update the endpoint and auth method accordingly.
    const url = "https://dashscope.aliyuncs.com/api/v1/services/aigc/text-generation/generation";
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${qwenApiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: qwenModel,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: messageText },
        ],
      }),
    });
    if (!res.ok) {
      console.error(`Qwen API failed: ${res.status} ${res.statusText}`);
      return { intent: INTENT_LABELS.unknown, confidence: 0, extracted_text: "" };
    }
    const data = await res.json();
    // Parse the response (adjust based on actual Qwen response format)
    const content = data.output?.choices?.[0]?.message?.content || "{}";
    const parsed = JSON.parse(content);
    return {
      intent: parsed.intent || INTENT_LABELS.unknown,
      confidence: parsed.confidence || 0,
      extracted_text: parsed.extracted_text || "",
    };
  } catch (err) {
    console.error(`classifyIntentQwen exception: ${err.message}`);
    return { intent: INTENT_LABELS.unknown, confidence: 0, extracted_text: "" };
  }
}

// Mirror & Risk Engine: Call MPC-8302 to get risk assessment
async function callMirrorAndRiskEngine(mirrorWorkerUrl, payload) {
  try {
    const res = await fetch(mirrorWorkerUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      console.error(`Mirror & Risk engine failed: ${res.status} ${res.statusText}`);
      return null;
    }
    return await res.json();
  } catch (err) {
    console.error(`callMirrorAndRiskEngine exception: ${err.message}`);
    return null;
  }
}

// Supabase: Log interaction for analytics
async function logInteraction(supabaseUrl, serviceKey, logEntry) {
  try {
    const url = `${supabaseUrl}/rest/v1/interaction_log`;
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${serviceKey}`,
        "apikey": serviceKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(logEntry),
    });
    if (!res.ok) {
      console.error(`logInteraction failed: ${res.status} ${res.statusText}`);
      return false;
    }
    return true;
  } catch (err) {
    console.error(`logInteraction exception: ${err.message}`);
    return false;
  }
}

// Social API: Route response back to X (Twitter DM)
async function sendXDM(xApiKey, recipientId, message) {
  try {
    // X API endpoint for sending DMs
    const url = "https://api.twitter.com/2/direct_messages";
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${xApiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        conversation_type: "Direct Message",
        participant_ids: [recipientId],
        message_data: {
          text: message,
        },
      }),
    });
    if (!res.ok) {
      console.error(`sendXDM failed: ${res.status} ${res.statusText}`);
      return false;
    }
    return true;
  } catch (err) {
    console.error(`sendXDM exception: ${err.message}`);
    return false;
  }
}

// Social API: Route response back to Telegram
async function sendTelegramMessage(telegramBotToken, chatId, message) {
  try {
    const url = `https://api.telegram.org/bot${telegramBotToken}/sendMessage`;
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: chatId,
        text: message,
        parse_mode: "Markdown",
      }),
    });
    if (!res.ok) {
      console.error(`sendTelegramMessage failed: ${res.status} ${res.statusText}`);
      return false;
    }
    return true;
  } catch (err) {
    console.error(`sendTelegramMessage exception: ${err.message}`);
    return false;
  }
}

// Rate limiting: Check if sender is rate-limited
async function isRateLimited(kv, senderId, maxPerMinute = 10) {
  const key = `rate_limit:${senderId}`;
  const count = await kv.get(key);
  const currentCount = parseInt(count || "0", 10);
  if (currentCount >= maxPerMinute) {
    return true;
  }
  await kv.put(key, String(currentCount + 1), { expirationTtl: 60 });
  return false;
}

// Main request handler
export default {
  async fetch(request, env) {
    // Verify webhook secret
    const secret = request.headers.get("X-Webhook-Secret") || "";
    if (env.WEBHOOK_SECRET && !constantTimeEqual(secret, env.WEBHOOK_SECRET)) {
      return new Response("Unauthorized", { status: 401 });
    }

    if (request.method === "POST") {
      return handleInboundPayload(request, env);
    }

    if (request.method === "GET") {
      // Health check endpoint
      return new Response(JSON.stringify({ status: "Core Brain operational" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }

    return new Response("Method not allowed", { status: 405 });
  },

  async scheduled(event, env) {
    // Cron-triggered queue consumption (e.g., every minute)
    // TODO: Implement queue polling if using cron instead of webhooks
    console.log("Scheduled queue consumption triggered");
  },
};

// Main orchestration logic: handle inbound payload
async function handleInboundPayload(request, env) {
  const startTime = Date.now();
  let payload;

  try {
    payload = await request.json();
  } catch {
    return new Response(JSON.stringify({ error: "Invalid JSON" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  // Expected payload shape from social_inbound_queue:
  // { id, sender_id, platform, message_text, metadata, created_at }
  const { id: queueId, sender_id: senderId, platform, message_text: messageText, metadata } = payload;

  if (!senderId || !platform || !messageText) {
    return new Response(
      JSON.stringify({ error: "Missing required fields: sender_id, platform, message_text" }),
      { status: 400, headers: { "Content-Type": "application/json" } }
    );
  }

  try {
    // Check rate limiting
    if (await isRateLimited(env.CORE_BRAIN_KV, senderId)) {
      console.warn(`Rate limit exceeded for ${senderId}`);
      return new Response(JSON.stringify({ error: "Rate limited" }), {
        status: 429,
        headers: { "Content-Type": "application/json" },
      });
    }

    // 1. Query user state
    const userState = await queryUserState(
      env.SUPABASE_URL,
      env.SUPABASE_SERVICE_KEY,
      senderId
    );
    const language = userState?.language_code || "en";
    const isKnownUser = !!userState;

    // 2. Classify intent using Qwen
    const intentResult = await classifyIntentQwen(
      env.QWEN_API_KEY,
      env.QWEN_MODEL,
      messageText
    );

    // 3. Extract entities from message
    const entities = extractEntities(messageText);

    // 4. If intent is query_scan, call Mirror & Risk engine
    let riskSummary = null;
    if (intentResult.intent === INTENT_LABELS.query_scan && Object.keys(entities).length > 0) {
      const mirrorPayload = {
        sender_id: senderId,
        entities,
        user_language: language,
      };
      riskSummary = await callMirrorAndRiskEngine(
        env.MIRROR_AND_RISK_WORKER_URL || "http://localhost:8787",
        mirrorPayload
      );
    }

    // 5. Get localization template
    const localization = await queryLocalization(
      env.SUPABASE_URL,
      env.SUPABASE_SERVICE_KEY,
      language
    );

    // 6. Format response (stub implementation)
    let responseText = `Intent: ${intentResult.intent}\nConfidence: ${intentResult.confidence}`;
    if (localization) {
      responseText = localization.greeting || responseText;
    }
    if (riskSummary) {
      responseText += `\n\nRisk Summary:\n${JSON.stringify(riskSummary)}`;
    }

    // 7. Route response back to correct platform
    let routeSuccess = false;
    if (platform === "x") {
      routeSuccess = await sendXDM(env.X_API_KEY, senderId, responseText);
    } else if (platform === "telegram") {
      routeSuccess = await sendTelegramMessage(env.TELEGRAM_BOT_TOKEN, senderId, responseText);
    } else {
      console.error(`Unknown platform: ${platform}`);
    }

    // 8. Log interaction
    const logEntry = {
      sender_id: senderId,
      platform,
      message_text: messageText,
      intent: intentResult.intent,
      confidence: intentResult.confidence,
      entities: JSON.stringify(entities),
      risk_summary: riskSummary ? JSON.stringify(riskSummary) : null,
      response_text: responseText,
      response_sent: routeSuccess,
      latency_ms: Date.now() - startTime,
      is_known_user: isKnownUser,
      created_at: new Date().toISOString(),
    };
    await logInteraction(env.SUPABASE_URL, env.SUPABASE_SERVICE_KEY, logEntry);

    // 9. Mark queue message as processed (if it came from queue)
    if (queueId) {
      await markQueueMessageProcessed(env.SUPABASE_URL, env.SUPABASE_SERVICE_KEY, queueId);
    }

    const latency = Date.now() - startTime;
    console.log(`Processed message from ${senderId} in ${latency}ms`);

    // 10. Return 200 OK
    return new Response(
      JSON.stringify({
        success: true,
        intent: intentResult.intent,
        latency_ms: latency,
        response_sent: routeSuccess,
      }),
      {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }
    );
  } catch (err) {
    console.error(`handleInboundPayload exception: ${err.message}`);
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
}
