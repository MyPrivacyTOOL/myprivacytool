import { describe, expect, it, vi } from "vitest";
import { sendHexagonInteraction } from "./useHexagonState";

describe("sendHexagonInteraction", () => {
  it("posts the payload in the API's field names", async () => {
    const f = vi.fn().mockResolvedValue({ ok: true });
    expect(await sendHexagonInteraction("sess_0123456789abcdef", "browser", "disputed", { originalConfidenceScore: 0.4, osintSource: "HIBP" }, f as unknown as typeof fetch)).toBe(true);
    const [url, init] = f.mock.calls[0];
    expect(String(url)).toMatch(/\/api\/scan\/hexagon-interaction$/);
    expect(JSON.parse(init.body)).toEqual({ scan_session_id: "sess_0123456789abcdef", hexagon_id: "browser", user_action: "disputed", original_confidence_score: 0.4, osint_source: "HIBP" });
  });
  it("resolves false instead of throwing on a network failure or a 403", async () => {
    expect(await sendHexagonInteraction("s", "browser", "confirmed", {}, vi.fn().mockRejectedValue(new Error("offline")) as unknown as typeof fetch)).toBe(false);
    expect(await sendHexagonInteraction("s", "browser", "confirmed", {}, vi.fn().mockResolvedValue({ ok: false, status: 403 }) as unknown as typeof fetch)).toBe(false);
  });
});
