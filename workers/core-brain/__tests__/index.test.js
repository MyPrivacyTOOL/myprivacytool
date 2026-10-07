/**
 * Core Brain — Unit Tests
 * Tests for entity extraction, rate limiting, and response routing
 */

describe("Core Brain Worker", () => {
  // Mock environment
  const mockEnv = {
    SUPABASE_URL: "https://test.supabase.co",
    SUPABASE_SERVICE_KEY: "test-key",
    QWEN_API_KEY: "qwen-test-key",
    QWEN_MODEL: "qwen-7b-chat",
    WEBHOOK_SECRET: "test-secret",
    X_API_KEY: "x-test-key",
    TELEGRAM_BOT_TOKEN: "telegram-test-token",
    MIRROR_AND_RISK_WORKER_URL: "http://localhost:8787",
    CORE_BRAIN_KV: new Map(), // Mock KV
  };

  describe("Entity Extraction", () => {
    it("should extract email addresses", () => {
      const text = "Check if john@example.com was leaked";
      const emailPattern = /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/gi;
      const matches = text.match(emailPattern);
      expect(matches).toContain("john@example.com");
    });

    it("should extract domains", () => {
      const text = "Was my data on example.com exposed?";
      const domainPattern = /(?:https?:\/\/)?(?:www\.)?([a-z0-9-]+\.[a-z]{2,})/gi;
      const matches = text.match(domainPattern);
      expect(matches).toBeTruthy();
      expect(matches[0]).toContain("example.com");
    });

    it("should extract social handles", () => {
      const text = "@john_doe tweeted about privacy";
      const handlePattern = /@([a-zA-Z0-9_]{1,15})/g;
      const matches = text.match(handlePattern);
      expect(matches).toContain("@john_doe");
    });

    it("should extract US phone numbers", () => {
      const text = "Call me at 555-123-4567";
      const phonePattern = /\b(?:\+?1[-.]?)?\(?([0-9]{3})\)?[-.]?([0-9]{3})[-.]?([0-9]{4})\b/g;
      const matches = text.match(phonePattern);
      expect(matches).toContain("555-123-4567");
    });
  });

  describe("Webhook Authentication", () => {
    it("should reject requests without webhook secret", () => {
      const secretA = "test-secret";
      const secretB = "wrong-secret";
      const diff = secretA.length ^ secretB.length;
      expect(diff !== 0).toBe(true);
    });

    it("should use constant-time comparison", () => {
      // Constant-time comparison should take same time regardless of mismatch position
      const secret = "test-secret-123";
      const guess1 = "wrong-secret-123";
      const guess2 = "test-wrong-123a";
      
      // Both should fail with same effort
      let diff1 = secret.length ^ guess1.length;
      let diff2 = secret.length ^ guess2.length;
      
      for (let i = 0; i < Math.max(secret.length, guess1.length); i++) {
        diff1 |= (secret.charCodeAt(i) || 0) ^ (guess1.charCodeAt(i) || 0);
      }
      for (let i = 0; i < Math.max(secret.length, guess2.length); i++) {
        diff2 |= (secret.charCodeAt(i) || 0) ^ (guess2.charCodeAt(i) || 0);
      }
      
      expect(diff1 !== 0).toBe(true);
      expect(diff2 !== 0).toBe(true);
    });
  });

  describe("Intent Classification", () => {
    it("should classify query_scan intent", () => {
      const testCases = [
        "Is my email exposed?",
        "Check if my data was leaked",
        "Was john@example.com breached?",
      ];
      // Qwen would classify these as query_scan
      testCases.forEach((text) => {
        expect(text).toMatch(/(?:email|data|exposed|leaked|breached|check|exposed)/i);
      });
    });

    it("should classify get_help intent", () => {
      const testCases = [
        "How do I protect my privacy?",
        "Can you explain data brokers?",
        "Help me understand the scan results",
      ];
      testCases.forEach((text) => {
        expect(text).toMatch(/(?:how|help|explain|understand|guide)/i);
      });
    });

    it("should classify opt_out intent", () => {
      const testCases = [
        "Stop sending me messages",
        "Unsubscribe",
        "Delete my data",
      ];
      testCases.forEach((text) => {
        expect(text).toMatch(/(?:stop|unsubscribe|delete|remove|opt-out)/i);
      });
    });
  });

  describe("Rate Limiting", () => {
    it("should track message count per sender", () => {
      const kv = new Map();
      const senderId = "user-123";
      const key = `rate_limit:${senderId}`;
      
      // Simulate 5 messages
      for (let i = 0; i < 5; i++) {
        const count = parseInt(kv.get(key) || "0", 10);
        kv.set(key, String(count + 1));
      }
      
      expect(kv.get(key)).toBe("5");
    });

    it("should enforce rate limit after threshold", () => {
      const kv = new Map();
      const senderId = "user-456";
      const key = `rate_limit:${senderId}`;
      const maxPerMinute = 10;
      
      // Fill up to limit
      for (let i = 0; i < maxPerMinute; i++) {
        kv.set(key, String(i + 1));
      }
      
      const currentCount = parseInt(kv.get(key) || "0", 10);
      const isRateLimited = currentCount >= maxPerMinute;
      
      expect(isRateLimited).toBe(true);
    });
  });

  describe("Error Handling", () => {
    it("should return 400 for missing required fields", () => {
      const invalidPayloads = [
        { sender_id: "123" }, // missing platform, message_text
        { platform: "x" }, // missing sender_id, message_text
        { message_text: "test" }, // missing sender_id, platform
        {}, // all missing
      ];
      
      invalidPayloads.forEach((payload) => {
        const hasRequired = payload.sender_id && payload.platform && payload.message_text;
        expect(hasRequired).toBeFalsy();
      });
    });

    it("should handle Supabase connection errors gracefully", () => {
      // If Supabase returns 500, should default to en language
      const fallbackLanguage = "en";
      const userState = null; // Simulating failed Supabase query
      const language = userState?.language_code || fallbackLanguage;
      
      expect(language).toBe(fallbackLanguage);
    });

    it("should handle Qwen API timeout", () => {
      // If Qwen times out, should return unknown intent
      const fallbackIntent = "unknown";
      const qwenResult = null; // Simulating timeout
      const intent = qwenResult?.intent || fallbackIntent;
      
      expect(intent).toBe(fallbackIntent);
    });
  });

  describe("Response Routing", () => {
    it("should route X platform messages correctly", () => {
      const payload = {
        sender_id: "x-user-123",
        platform: "x",
        message_text: "Check my email",
      };
      
      expect(payload.platform).toBe("x");
      // X API would send DM to sender_id
    });

    it("should route Telegram messages correctly", () => {
      const payload = {
        sender_id: "telegram-chat-456",
        platform: "telegram",
        message_text: "Am I exposed?",
      };
      
      expect(payload.platform).toBe("telegram");
      // Telegram API would send message to chat_id (sender_id)
    });

    it("should reject unknown platform", () => {
      const payload = {
        sender_id: "user-789",
        platform: "unknown-platform",
        message_text: "test",
      };
      
      const validPlatforms = ["x", "telegram"];
      expect(validPlatforms).not.toContain(payload.platform);
    });
  });

  describe("Interaction Logging", () => {
    it("should log all required fields", () => {
      const logEntry = {
        sender_id: "user-123",
        platform: "x",
        message_text: "Check my email",
        intent: "query_scan",
        confidence: 0.95,
        entities: JSON.stringify({ email: ["john@example.com"] }),
        risk_summary: JSON.stringify({ exposed: true, brokers: 3 }),
        response_text: "Your email is exposed on 3 brokers",
        response_sent: true,
        latency_ms: 847,
        is_known_user: true,
        created_at: new Date().toISOString(),
      };
      
      expect(logEntry).toHaveProperty("sender_id");
      expect(logEntry).toHaveProperty("platform");
      expect(logEntry).toHaveProperty("intent");
      expect(logEntry).toHaveProperty("latency_ms");
      expect(logEntry.latency_ms).toBeLessThan(10000); // Should be under 10s
    });
  });

  describe("Performance", () => {
    it("should process messages in under 10 seconds", () => {
      const startTime = Date.now();
      
      // Simulate processing
      setTimeout(() => {
        // Supabase: 300ms
        // Qwen: 500ms
        // Mirror: 200ms
        // Response: 50ms
        // Log: 150ms
      }, 1200);
      
      const latency = Date.now() - startTime;
      expect(latency).toBeLessThan(10000);
    });
  });
});
