import { describe, expect, it, vi } from "vitest";
import { deleteMyData, loadResults, startCheck, verifyCode, deepResearchEnabled } from "./deepResearchApi";

const reply = (body: unknown, status = 200) => vi.fn().mockResolvedValue(new Response(JSON.stringify(body), { status })) as unknown as typeof fetch;
const lastCall = (f: typeof fetch) => (f as unknown as ReturnType<typeof vi.fn>).mock.calls[0] as [string, RequestInit];

describe("deepResearchApi", () => {
  it("is off unless VITE_DEEP_RESEARCH is exactly 'true'", () => {
    expect(deepResearchEnabled()).toBe(false);
    vi.stubEnv("VITE_DEEP_RESEARCH", "true");
    expect(deepResearchEnabled()).toBe(true);
    vi.stubEnv("VITE_DEEP_RESEARCH", "1");
    expect(deepResearchEnabled()).toBe(false);
    vi.unstubAllEnvs();
  });

  it("start: POSTs the address and the Turnstile token under the name the Worker reads, with no cookies and no referrer", async () => {
    const f = reply({ ok: true, challenge_id: "cid" });
    const r = await startCheck("a@example.com", "tok", f);
    const [url, init] = lastCall(f);
    expect(url).toMatch(/\/api\/deep-research\/start$/);
    expect(JSON.parse(String(init.body))).toEqual({ email: "a@example.com", "cf-turnstile-response": "tok" });
    expect(init.method).toBe("POST");
    expect(init.credentials).toBe("omit");
    expect(init.referrerPolicy).toBe("no-referrer");
    expect(r.ok).toBe(true);
    expect(r.data.challenge_id).toBe("cid");
  });

  it("verify, results and delete send the right fields", async () => {
    let f = reply({ ok: true, verified: true, token: "t", expires_in: 3600 });
    expect((await verifyCode("cid", "a@example.com", "123456", f)).data.token).toBe("t");
    expect(JSON.parse(String(lastCall(f)[1].body))).toEqual({ challenge_id: "cid", email: "a@example.com", code: "123456" });
    f = reply({ ok: true, findings: [], retention_days: 90, min_confidence: 80 });
    expect((await loadResults("t", f)).data.retention_days).toBe(90);
    expect(lastCall(f)[0]).toMatch(/\/results$/);
    f = reply({ ok: true, deleted: 2 });
    expect((await deleteMyData("t", f)).data.deleted).toBe(2);
    expect(lastCall(f)[0]).toMatch(/\/delete$/);
  });

  it("turns every failure into an error message and never throws", async () => {
    const wrong = await verifyCode("cid", "a@example.com", "000000", reply({ ok: false, status: "wrong", error: "That code is not right." }, 400));
    expect(wrong).toEqual({ ok: false, error: "That code is not right.", status: "wrong" });
    const junk = await startCheck("a@example.com", "", reply("not json", 502));
    expect(junk.ok).toBe(false);
    expect(junk.error).toMatch(/something went wrong/i);
    const offline = await loadResults("t", vi.fn().mockRejectedValue(new Error("offline")) as unknown as typeof fetch);
    expect(offline.ok).toBe(false);
    expect(offline.error).toMatch(/could not reach/i);
  });
});
