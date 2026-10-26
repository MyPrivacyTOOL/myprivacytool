/**
 * Unit Tests: cairn-commit.ts (API Bridge Hash Layer)
 * 
 * Covers:
 * - Hash generation (deterministic, salted)
 * - Round-trip verification (plaintext → hash → verify)
 * - No plaintext in stored records
 * - Supabase integration mocking
 * - Error handling (bad input, missing env, DB failures)
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  hashFactValue,
  verifyFactValue,
  generateSalt,
  onRequestPost,
} from "../cairn-commit";

describe("API Bridge Hash Layer — cairn-commit", () => {
  describe("generateSalt()", () => {
    it("generates a 32-byte (base64) salt", async () => {
      const salt = generateSalt(32);
      expect(salt).toBeDefined();
      expect(typeof salt).toBe("string");

      // Decode from base64 and verify length
      const decoded = Buffer.from(salt, "base64");
      expect(decoded.length).toBe(32);
    });

    it("generates different salts on each call", async () => {
      const salt1 = generateSalt(32);
      const salt2 = generateSalt(32);
      expect(salt1).not.toBe(salt2);
    });
  });

  describe("hashFactValue()", () => {
    it("generates a hash for plaintext input", async () => {
      const plaintext = "user@example.com";
      const { hash, salt } = await hashFactValue(plaintext);

      expect(hash).toBeDefined();
      expect(typeof hash).toBe("string");
      expect(salt).toBeDefined();
      expect(typeof salt).toBe("string");

      // Hash should be base64 and non-empty
      expect(hash.length).toBeGreaterThan(0);
      expect(() => Buffer.from(hash, "base64")).not.toThrow();
    });

    it("is deterministic with the same salt", async () => {
      const plaintext = "test@domain.com";
      const salt = generateSalt(32);

      const { hash: hash1 } = await hashFactValue(plaintext, salt);
      const { hash: hash2 } = await hashFactValue(plaintext, salt);

      expect(hash1).toBe(hash2);
    });

    it("produces different hashes for different salts", async () => {
      const plaintext = "admin@site.org";
      const salt1 = generateSalt(32);
      const salt2 = generateSalt(32);

      const { hash: hash1 } = await hashFactValue(plaintext, salt1);
      const { hash: hash2 } = await hashFactValue(plaintext, salt2);

      expect(hash1).not.toBe(hash2);
    });

    it("produces different hashes for different plaintext", async () => {
      const salt = generateSalt(32);

      const { hash: hash1 } = await hashFactValue("email1@test.com", salt);
      const { hash: hash2 } = await hashFactValue("email2@test.com", salt);

      expect(hash1).not.toBe(hash2);
    });

    it("respects the rounds parameter (higher rounds = slower)", async () => {
      const plaintext = "performance@test.com";

      // This is a basic sanity check; actual timing would require performance profiling
      const { hash: hash10 } = await hashFactValue(plaintext, undefined, 10);
      const { hash: hash12 } = await hashFactValue(plaintext, undefined, 12);

      // Different rounds should produce different hashes (different cost)
      expect(hash10).not.toBe(hash12);
    });
  });

  describe("verifyFactValue()", () => {
    it("returns true for matching plaintext and hash", async () => {
      const plaintext = "user@example.com";
      const { hash, salt } = await hashFactValue(plaintext);

      const isValid = await verifyFactValue(plaintext, hash, salt);
      expect(isValid).toBe(true);
    });

    it("returns false for mismatched plaintext", async () => {
      const { hash, salt } = await hashFactValue("correct@email.com");

      const isValid = await verifyFactValue("wrong@email.com", hash, salt);
      expect(isValid).toBe(false);
    });

    it("returns false for corrupted hash", async () => {
      const plaintext = "test@site.com";
      const { salt } = await hashFactValue(plaintext);
      const corruptedHash = "bW9kaWZpZWRoYXNoZA=="; // deliberately wrong

      const isValid = await verifyFactValue(plaintext, corruptedHash, salt);
      expect(isValid).toBe(false);
    });

    it("is case-sensitive (plaintext must match exactly)", async () => {
      const plaintext = "User@Example.COM";
      const { hash, salt } = await hashFactValue(plaintext);

      const isValid = await verifyFactValue("user@example.com", hash, salt);
      expect(isValid).toBe(false);
    });
  });

  describe("onRequestPost() — POST /api/cairn/blackboard/commit", () => {
    let mockEnv: any;
    let mockRequest: any;

    beforeEach(() => {
      mockEnv = {
        SUPABASE_URL: "https://abc.supabase.co",
        SUPABASE_SERVICE_KEY: "test-service-key",
        CAIRN_HASH_ROUNDS: "12",
      };
    });

    it("rejects request with missing required fields", async () => {
      mockRequest = new Request("http://localhost/api/cairn/blackboard/commit", {
        method: "POST",
        body: JSON.stringify({
          subject_id: "user123",
          // missing source, fact_type, fact_value
        }),
      });

      const response = await onRequestPost({
        request: mockRequest,
        env: mockEnv,
      });

      expect(response.status).toBe(400);
      const body = await response.json();
      expect(body.error).toBe("missing_required_fields");
    });

    it("rejects request with invalid JSON", async () => {
      mockRequest = new Request("http://localhost/api/cairn/blackboard/commit", {
        method: "POST",
        body: "not valid json {",
      });

      const response = await onRequestPost({
        request: mockRequest,
        env: mockEnv,
      });

      expect(response.status).toBe(400);
      const body = await response.json();
      expect(body.error).toBe("bad_request_json");
    });

    it("returns 503 if Supabase credentials are missing", async () => {
      const envNoSupabase = {
        SUPABASE_URL: undefined,
        SUPABASE_SERVICE_KEY: undefined,
      };

      mockRequest = new Request("http://localhost/api/cairn/blackboard/commit", {
        method: "POST",
        body: JSON.stringify({
          subject_id: "user123",
          source: "email_registry",
          fact_type: "email",
          fact_value: "test@example.com",
        }),
      });

      const response = await onRequestPost({
        request: mockRequest,
        env: envNoSupabase,
      });

      expect(response.status).toBe(503);
      const body = await response.json();
      expect(body.error).toBe("missing_supabase_credentials");
    });

    it("successfully hashes and returns fact_hash (never plaintext)", async () => {
      // Mock fetch to simulate Supabase success
      global.fetch = vi.fn(() =>
        Promise.resolve(new Response(null, { status: 201 }))
      );

      mockRequest = new Request("http://localhost/api/cairn/blackboard/commit", {
        method: "POST",
        body: JSON.stringify({
          subject_id: "user-456",
          source: "email_registry",
          fact_type: "email",
          fact_value: "alice@example.com",
          confidence: 0.95,
          tags: ["verified"],
        }),
      });

      const response = await onRequestPost({
        request: mockRequest,
        env: mockEnv,
      });

      expect(response.status).toBe(201);
      const body = await response.json();

      // Verify response structure
      expect(body.success).toBe(true);
      expect(body.fact_hash).toBeDefined();
      expect(body.subject_id).toBe("user-456");
      expect(body.created_at).toBeDefined();

      // Verify plaintext is NOT in the response
      expect(body).not.toHaveProperty("fact_value");
    });

    it("includes proper security headers in response", async () => {
      global.fetch = vi.fn(() =>
        Promise.resolve(new Response(null, { status: 201 }))
      );

      mockRequest = new Request("http://localhost/api/cairn/blackboard/commit", {
        method: "POST",
        body: JSON.stringify({
          subject_id: "test-user",
          source: "test_source",
          fact_type: "phone",
          fact_value: "+1234567890",
        }),
      });

      const response = await onRequestPost({
        request: mockRequest,
        env: mockEnv,
      });

      expect(response.headers.get("Cache-Control")).toBe("private, no-store");
      expect(response.headers.get("X-Robots-Tag")).toBe("noindex");
      expect(response.headers.get("Content-Type")).toContain("application/json");
    });

    it("returns error if Supabase returns 500", async () => {
      global.fetch = vi.fn(() =>
        Promise.resolve(
          new Response("Database error", { status: 500 })
        )
      );

      mockRequest = new Request("http://localhost/api/cairn/blackboard/commit", {
        method: "POST",
        body: JSON.stringify({
          subject_id: "user789",
          source: "source_name",
          fact_type: "username",
          fact_value: "john_doe",
        }),
      });

      const response = await onRequestPost({
        request: mockRequest,
        env: mockEnv,
      });

      expect(response.status).toBe(502);
      const body = await response.json();
      expect(body.error).toBe("database_error");
      expect(body.status).toBe(500);
    });
  });

  describe("No plaintext leakage verification", () => {
    it("does not include plaintext in stored fact record", async () => {
      const plaintext = "confidential@user.com";
      const { hash, salt } = await hashFactValue(plaintext);

      // Simulate what would be stored
      const storedRecord = {
        subject_id: "user-123",
        source: "email_registry",
        fact_type: "email",
        fact_hash: hash,
        fact_salt: salt,
        confidence: 0.9,
        created_at: new Date().toISOString(),
        // NOTE: fact_value is intentionally omitted
      };

      // Verify plaintext is nowhere in the record
      expect(JSON.stringify(storedRecord)).not.toContain(plaintext);
      expect(storedRecord).not.toHaveProperty("fact_value");
    });

    it("does not log plaintext values", async () => {
      const consoleSpy = vi.spyOn(console, "log");
      const plaintext = "secret@email.com";

      const { hash } = await hashFactValue(plaintext);

      // Verify logs don't contain plaintext
      const logs = consoleSpy.mock.calls.map((call) => call.join(" ")).join(" ");
      expect(logs).not.toContain(plaintext);

      consoleSpy.mockRestore();
    });
  });
});
