// MPC-10612: a rate-limited (429) read of the invitation is retried before the page says "We could not open the invitation just now".
import { describe, it, expect, vi, afterEach } from "vitest";
import { viewInvitation } from "./businessTeam";

const ok = { status: "invited", company: "Synthetic Quillfeather Ltd", email: "e@example.test", share_detail: false, checked_at: null, results: [] };
const res = (status: number, body: unknown = {}) => ({ ok: status < 400, status, json: async () => body, text: async () => JSON.stringify(body) }) as unknown as Response;
afterEach(() => vi.unstubAllGlobals());

describe("viewInvitation", () => {
  it("retries a 429 and then shows the invitation", async () => {
    const f = vi.fn().mockResolvedValueOnce(res(429)).mockResolvedValueOnce(res(429)).mockResolvedValueOnce(res(200, ok));
    vi.stubGlobal("fetch", f);
    const r = await viewInvitation("t".repeat(43), [0, 0]);
    expect(typeof r).toBe("object");
    expect(f).toHaveBeenCalledTimes(3);
  });
  it("gives up with error after the retries are used", async () => {
    const f = vi.fn().mockResolvedValue(res(429));
    vi.stubGlobal("fetch", f);
    expect(await viewInvitation("t".repeat(43), [0, 0])).toBe("error");
    expect(f).toHaveBeenCalledTimes(3);
  });
  it("does not retry a 404 (not valid or expired)", async () => {
    const f = vi.fn().mockResolvedValue(res(404));
    vi.stubGlobal("fetch", f);
    expect(await viewInvitation("t".repeat(43), [0, 0])).toBe("gone");
    expect(f).toHaveBeenCalledTimes(1);
  });
});
