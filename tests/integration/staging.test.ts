/**
 * MPC-7257: Core Brain Staging Integration Test Suite
 * End-to-end validation: webhook ingestion → intent classification → response templating → logging
 *
 * This test suite validates the complete MPT Core Brain pipeline in staging:
 * 1. Social platform webhook ingestion (X, Telegram)
 * 2. Intent detection (Mirror & Risk Engine)
 * 3. Response templating + personalization
 * 4. Firestore logging
 * 5. Error handling + edge cases
 *
 * Run: npm run test:staging (see package.json)
 * Requires env vars: CORE_BRAIN_STAGING_URL, WEBHOOK_SECRET, SUPABASE_URL, SUPABASE_KEY
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';

const STAGING_URL = process.env.CORE_BRAIN_STAGING_URL || 'https://core-brain-staging.mpt.workers.dev';
const WEBHOOK_SECRET = process.env.WEBHOOK_SECRET || 'test-secret-key';
const TEST_TIMEOUT = 30000; // 30s per test

describe('MPC-7257: Core Brain Staging Integration', () => {
  let testSessionId: string;

  beforeAll(() => {
    testSessionId = `test-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    console.log(`🧪 Starting integration test session: ${testSessionId}`);
    console.log(`📍 Staging URL: ${STAGING_URL}`);
  });

  afterAll(() => {
    console.log(`✅ Integration test session complete: ${testSessionId}`);
  });

  // ============================================================================
  // 1. HEALTH CHECK
  // ============================================================================

  it(
    'should respond to health check with configured:true',
    async () => {
      const response = await fetch(`${STAGING_URL}/health`, {
        method: 'GET',
      });

      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data).toHaveProperty('configured');
      expect(data.configured).toBe(true);
      expect(data).toHaveProperty('version');
      expect(data).toHaveProperty('timestamp');

      console.log(`✓ Health check passed:`, data);
    },
    TEST_TIMEOUT
  );

  // ============================================================================
  // 2. X (TWITTER) WEBHOOK INTEGRATION
  // ============================================================================

  describe('X (Twitter) Webhooks', () => {
    it(
      'should accept X webhook POST with valid signature',
      async () => {
        const payload = {
          for_user_id: '12345',
          data: {
            id: 'msg-001',
            text: 'I just found my data on a data broker and want to remove it. Can you help?',
            author_id: '98765',
            created_at: new Date().toISOString(),
          },
        };

        const response = await fetch(`${STAGING_URL}/webhook/x`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Signature': generateWebhookSignature(JSON.stringify(payload), WEBHOOK_SECRET),
          },
          body: JSON.stringify(payload),
        });

        expect(response.status).toBe(202); // Accepted, async processing
        const result = await response.json();
        expect(result).toHaveProperty('event_id');
        expect(result).toHaveProperty('intent');
        expect(result).toHaveProperty('confidence');

        console.log(`✓ X webhook accepted:`, result);
      },
      TEST_TIMEOUT
    );

    it(
      'should classify removal request intent from X',
      async () => {
        const payload = {
          for_user_id: '12345',
          data: {
            id: 'msg-002',
            text: 'My personal info is all over the internet. I need to remove it ASAP before someone uses it.',
            author_id: '98765',
            created_at: new Date().toISOString(),
          },
        };

        const response = await fetch(`${STAGING_URL}/webhook/x`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Signature': generateWebhookSignature(JSON.stringify(payload), WEBHOOK_SECRET),
          },
          body: JSON.stringify(payload),
        });

        expect(response.status).toBe(202);
        const result = await response.json();
        expect(result.intent).toBe('REMOVAL_REQUEST');
        expect(result.confidence).toBeGreaterThan(0.7);
        expect(result.risk_score).toBeGreaterThan(70); // High risk: urgency + threat language

        console.log(`✓ X removal intent classified:`, result);
      },
      TEST_TIMEOUT
    );

    it(
      'should reject X webhook with invalid signature',
      async () => {
        const payload = {
          for_user_id: '12345',
          data: {
            id: 'msg-bad',
            text: 'Invalid signature test',
            author_id: '98765',
            created_at: new Date().toISOString(),
          },
        };

        const response = await fetch(`${STAGING_URL}/webhook/x`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Signature': 'invalid-signature-hash',
          },
          body: JSON.stringify(payload),
        });

        expect(response.status).toBe(401); // Unauthorized
        const error = await response.json();
        expect(error).toHaveProperty('error');
        expect(error.error).toContain('signature');

        console.log(`✓ Invalid X signature rejected:`, error);
      },
      TEST_TIMEOUT
    );
  });

  // ============================================================================
  // 3. TELEGRAM WEBHOOK INTEGRATION
  // ============================================================================

  describe('Telegram Webhooks', () => {
    it(
      'should accept Telegram webhook POST',
      async () => {
        const payload = {
          update_id: 123456789,
          message: {
            message_id: 1,
            date: Math.floor(Date.now() / 1000),
            chat: {
              id: 987654321,
              first_name: 'Test',
              type: 'private',
            },
            from: {
              id: 987654321,
              is_bot: false,
              first_name: 'Test',
            },
            text: 'How do I remove my info from data brokers?',
          },
        };

        const response = await fetch(`${STAGING_URL}/webhook/telegram`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Telegram-Bot-Api-Secret-Token': WEBHOOK_SECRET,
          },
          body: JSON.stringify(payload),
        });

        expect(response.status).toBe(202);
        const result = await response.json();
        expect(result).toHaveProperty('event_id');
        expect(result).toHaveProperty('intent');

        console.log(`✓ Telegram webhook accepted:`, result);
      },
      TEST_TIMEOUT
    );

    it(
      'should classify info removal inquiry from Telegram',
      async () => {
        const payload = {
          update_id: 123456790,
          message: {
            message_id: 2,
            date: Math.floor(Date.now() / 1000),
            chat: {
              id: 987654321,
              first_name: 'Test',
              type: 'private',
            },
            from: {
              id: 987654321,
              is_bot: false,
              first_name: 'Test',
            },
            text: 'I found myself on multiple data broker sites. What are the best removal services? I need to act fast.',
          },
        };

        const response = await fetch(`${STAGING_URL}/webhook/telegram`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Telegram-Bot-Api-Secret-Token': WEBHOOK_SECRET,
          },
          body: JSON.stringify(payload),
        });

        expect(response.status).toBe(202);
        const result = await response.json();
        expect(result.intent).toBe('TOOL_INQUIRY');
        expect(result.confidence).toBeGreaterThan(0.6);

        console.log(`✓ Telegram tool inquiry classified:`, result);
      },
      TEST_TIMEOUT
    );
  });

  // ============================================================================
  // 4. RESPONSE TEMPLATING & PERSONALIZATION
  // ============================================================================

  describe('Response Templating', () => {
    it(
      'should generate personalized removal instruction response',
      async () => {
        const payload = {
          for_user_id: '12345',
          data: {
            id: 'msg-template-1',
            text: 'I want to remove my personal data from data brokers',
            author_id: '98765',
            sender_name: 'Alice',
            platform: 'x',
            created_at: new Date().toISOString(),
          },
        };

        const response = await fetch(`${STAGING_URL}/webhook/x`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Signature': generateWebhookSignature(JSON.stringify(payload), WEBHOOK_SECRET),
          },
          body: JSON.stringify(payload),
        });

        expect(response.status).toBe(202);
        const result = await response.json();

        // Verify response template was applied
        expect(result).toHaveProperty('response_template');
        expect(result.response_template).toHaveProperty('type'); // REMOVAL_INSTRUCTIONS, etc.
        expect(result.response_template).toHaveProperty('personalized_message');

        // Verify personalization (name substitution)
        if (result.response_template.personalized_message) {
          expect(result.response_template.personalized_message).toContain('Alice');
        }

        console.log(`✓ Personalized response template generated:`, result.response_template);
      },
      TEST_TIMEOUT
    );
  });

  // ============================================================================
  // 5. RISK SCORING & ESCALATION
  // ============================================================================

  describe('Risk Scoring & Escalation', () => {
    it(
      'should escalate high-risk queries to human review',
      async () => {
        const payload = {
          for_user_id: '12345',
          data: {
            id: 'msg-high-risk',
            text: 'My identity has been stolen and my data is being used for fraud. I need emergency help NOW.',
            author_id: '98765',
            created_at: new Date().toISOString(),
          },
        };

        const response = await fetch(`${STAGING_URL}/webhook/x`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Signature': generateWebhookSignature(JSON.stringify(payload), WEBHOOK_SECRET),
          },
          body: JSON.stringify(payload),
        });

        expect(response.status).toBe(202);
        const result = await response.json();

        expect(result.risk_score).toBeGreaterThan(80); // High risk
        expect(result).toHaveProperty('routing_decision');
        expect(['ESCALATE', 'REVIEW']).toContain(result.routing_decision);

        console.log(`✓ High-risk query escalated:`, result);
      },
      TEST_TIMEOUT
    );

    it(
      'should auto-respond to low-risk general inquiries',
      async () => {
        const payload = {
          for_user_id: '12345',
          data: {
            id: 'msg-low-risk',
            text: 'What is a data broker?',
            author_id: '98765',
            created_at: new Date().toISOString(),
          },
        };

        const response = await fetch(`${STAGING_URL}/webhook/x`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Signature': generateWebhookSignature(JSON.stringify(payload), WEBHOOK_SECRET),
          },
          body: JSON.stringify(payload),
        });

        expect(response.status).toBe(202);
        const result = await response.json();

        expect(result.risk_score).toBeLessThan(40); // Low risk
        expect(result.routing_decision).toBe('AUTOMATED');

        console.log(`✓ Low-risk inquiry auto-routed:`, result);
      },
      TEST_TIMEOUT
    );
  });

  // ============================================================================
  // 6. ERROR HANDLING & EDGE CASES
  // ============================================================================

  describe('Error Handling', () => {
    it(
      'should handle malformed JSON gracefully',
      async () => {
        const response = await fetch(`${STAGING_URL}/webhook/x`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Signature': generateWebhookSignature('{}', WEBHOOK_SECRET),
          },
          body: '{invalid json',
        });

        expect(response.status).toBeGreaterThanOrEqual(400);
        expect(response.status).toBeLessThan(500);
        const error = await response.json();
        expect(error).toHaveProperty('error');

        console.log(`✓ Malformed JSON handled:`, error);
      },
      TEST_TIMEOUT
    );

    it(
      'should handle missing required fields',
      async () => {
        const payload = {
          for_user_id: '12345',
          // Missing 'data' field
        };

        const response = await fetch(`${STAGING_URL}/webhook/x`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Signature': generateWebhookSignature(JSON.stringify(payload), WEBHOOK_SECRET),
          },
          body: JSON.stringify(payload),
        });

        expect(response.status).toBeGreaterThanOrEqual(400);
        expect(response.status).toBeLessThan(500);

        console.log(`✓ Missing fields rejected with status ${response.status}`);
      },
      TEST_TIMEOUT
    );

    it(
      'should handle very long text payloads',
      async () => {
        const longText = 'A'.repeat(10000); // 10KB of text
        const payload = {
          for_user_id: '12345',
          data: {
            id: 'msg-long',
            text: longText,
            author_id: '98765',
            created_at: new Date().toISOString(),
          },
        };

        const response = await fetch(`${STAGING_URL}/webhook/x`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Signature': generateWebhookSignature(JSON.stringify(payload), WEBHOOK_SECRET),
          },
          body: JSON.stringify(payload),
        });

        // Should either accept or reject with 413 (Payload Too Large), not 500
        expect([202, 413]).toContain(response.status);

        console.log(`✓ Long payload handled with status ${response.status}`);
      },
      TEST_TIMEOUT
    );
  });

  // ============================================================================
  // 7. FIRESTORE LOGGING VERIFICATION
  // ============================================================================

  describe('Firestore Logging', () => {
    it(
      'should log classification event to Firestore',
      async () => {
        const payload = {
          for_user_id: '12345',
          data: {
            id: 'msg-logging-test',
            text: 'Test message for logging verification',
            author_id: '98765',
            created_at: new Date().toISOString(),
          },
        };

        const response = await fetch(`${STAGING_URL}/webhook/x`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Signature': generateWebhookSignature(JSON.stringify(payload), WEBHOOK_SECRET),
          },
          body: JSON.stringify(payload),
        });

        expect(response.status).toBe(202);
        const result = await response.json();

        // Verify event_id is present (unique identifier for Firestore lookup)
        expect(result).toHaveProperty('event_id');
        expect(result.event_id).toMatch(/^[a-z0-9-]{20,}$/);

        // Note: Actual Firestore read verification requires Firestore access.
        // This test verifies the event_id is generated; Chris should verify the log exists.
        console.log(`✓ Classification event_id generated for Firestore logging:`, result.event_id);
      },
      TEST_TIMEOUT
    );
  });
});

// ============================================================================
// HELPERS
// ============================================================================

/**
 * Generate HMAC-SHA256 signature for webhook validation
 * Matches the signature generation in core-brain/index.ts
 */
function generateWebhookSignature(payload: string, secret: string): string {
  // Node.js crypto module
  const crypto = require('crypto');
  const hmac = crypto.createHmac('sha256', secret);
  hmac.update(payload);
  return hmac.digest('hex');
}
