// @vitest-environment node
/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect } from "vitest";
import { importSigningKey, signReport, verifySignedReport, canonicalize } from "./signing";
import { buildTimeStampReq, responseStatus, rfc3161Timestamper } from "./timestamp";
import { handleDownload, handleVerify, type Deps, type SignedReportEnv } from "./handlers";

const seed = btoa(String.fromCharCode(...new Uint8Array(32).map((_, i) => i + 1)));
const report = { schema_version: 1, report_id: "r1", score: { value: 90 }, hexagons: [{ id: "location", value: "Hong Kong" }] };
const post = (url: string, body: unknown) => new Request("https://x.test" + url, { method: "POST", body: typeof body === "string" ? body : JSON.stringify(body) });

describe("signing", () => {
  it("round-trips and detects tampering", async () => {
    const key = await importSigningKey(seed);
    const signed = await signReport(report, key, { now: new Date("2026-10-26T00:00:00Z") });
    expect((await verifySignedReport(signed, [signed.signature.public_key])).issuer_key_trusted).toBe(true);
    const bad = structuredClone(signed) as any;
    bad.report.score.value = 100;
    expect((await verifySignedReport(bad)).signature_valid).toBe(false);
    const bad2 = structuredClone(signed) as any;
    bad2.signature.signed_at = "2026-10-27T00:00:00.000Z";
    expect((await verifySignedReport(bad2)).signature_valid).toBe(false);
  });
  it("is independent of key order, and a stranger's key is valid but not trusted", async () => {
    const key = await importSigningKey(seed);
    const a = await signReport({ b: 1, a: 2 }, key, { now: new Date(0) });
    expect(canonicalize({ b: 1, a: 2 })).toBe(canonicalize({ a: 2, b: 1 }));
    const r = await verifySignedReport(a, ["some-other-key"]);
    expect(r.signature_valid).toBe(true);
    expect(r.issuer_key_trusted).toBe(false);
  });
  it("rejects non-finite numbers and garbage", async () => {
    expect(() => canonicalize({ a: NaN })).toThrow();
    expect((await verifySignedReport({ nope: 1 })).signature_valid).toBe(false);
    expect((await verifySignedReport(null)).signature_valid).toBe(false);
  });
});

describe("rfc3161", () => {
  it("builds a well-formed request and reads the status", () => {
    const req = buildTimeStampReq(new Uint8Array(32).fill(7), Uint8Array.from([1, 2, 3, 4, 5, 6, 7, 8]));
    expect(req[0]).toBe(0x30);
    expect(req.length).toBe(req[1] + 2);
    expect(responseStatus(Uint8Array.from([0x30, 0x05, 0x30, 0x03, 0x02, 0x01, 0x00]))).toBe(0);
    expect(responseStatus(Uint8Array.from([0x30, 0x05, 0x30, 0x03, 0x02, 0x01, 0x02]))).toBe(2);
  });
  it("binds the stamped digest and survives an authority outage", async () => {
    const key = await importSigningKey(seed);
    const ts = rfc3161Timestamper("https://tsa.test/ts", (async () => {
      return new Response(Uint8Array.from([0x30, 0x05, 0x30, 0x03, 0x02, 0x01, 0x00]), { status: 200 });
    }) as any);
    const signed = await signReport(report, key, { timestamper: ts });
    expect(signed.signature.timestamp?.authority).toBe("tsa.test");
    // token here is a stub that does not contain the digest, so it must NOT be reported as binding it
    expect((await verifySignedReport(signed, [signed.signature.public_key])).timestamp_binds_digest).toBe(false);
    const down = await signReport(report, key, { timestamper: async () => { throw new Error("down"); } });
    expect(down.signature.timestamp).toBeNull();
  });
});

describe("handlers", () => {
  const key = seed;
  const env: SignedReportEnv = { REPORT_SIGNING_ENABLED: "1", REPORT_SIGNING_KEY: key };
  const open: Deps = { level2Passed: async () => true, now: new Date("2026-10-26T00:00:00Z") };

  it("fails closed: disabled, no key, or Level 2 not passed", async () => {
    expect((await handleDownload(post("/", { report }), {}, open)).status).toBe(503);
    expect((await handleDownload(post("/", { report }), { REPORT_SIGNING_ENABLED: "1" }, open)).status).toBe(503);
    expect((await handleDownload(post("/", { report }), env, { level2Passed: async () => false })).status).toBe(403);
    expect((await handleDownload(post("/", { report }), env)).status).toBe(403); // default deps: gate (MPC-7902) not built
  });
  it("rejects bad input and wrong methods", async () => {
    expect((await handleDownload(post("/", "{nope"), env, open)).status).toBe(400);
    expect((await handleDownload(post("/", { x: 1 }), env, open)).status).toBe(400);
    expect((await handleDownload(new Request("https://x.test/", { method: "GET" }), env, open)).status).toBe(405);
    expect((await handleDownload(post("/", "x".repeat(1_000_001)), env, open)).status).toBe(413);
    expect((await handleDownload(post("/", { report }), { ...env, REPORT_SIGNING_KEY: "not base64 !!" }, open)).status).toBe(503);
  });
  it("download then verify end to end, JSON", async () => {
    const dl = await handleDownload(post("/", { report }), env, open);
    expect(dl.status).toBe(200);
    const signed = await dl.json();
    const pub = signed.signature.public_key;
    const ok = await (await handleVerify(post("/", signed), { REPORT_SIGNING_PUBLIC_KEYS: pub })).json();
    expect(ok.verified).toBe(true);
    const unknown = await (await handleVerify(post("/", signed), { REPORT_SIGNING_PUBLIC_KEYS: "other" })).json();
    expect(unknown.verified).toBe(false);
    expect(unknown.signature_valid).toBe(true);
    signed.report.hexagons[0].value = "Elsewhere";
    expect((await (await handleVerify(post("/", signed), { REPORT_SIGNING_PUBLIC_KEYS: pub })).json()).verified).toBe(false);
  });
  it("download then verify end to end, PDF", async () => {
    const pdf = new TextEncoder().encode("%PDF-1.4 fake");
    const b64 = btoa(String.fromCharCode(...pdf));
    const { signature } = await (await handleDownload(post("/", { pdf_base64: b64 }), env, open)).json();
    const keys = { REPORT_SIGNING_PUBLIC_KEYS: signature.public_key };
    expect((await (await handleVerify(post("/", { pdf_base64: b64, signature }), keys)).json()).verified).toBe(true);
    const changed = btoa(String.fromCharCode(...new TextEncoder().encode("%PDF-1.4 edited")));
    const r = await (await handleVerify(post("/", { pdf_base64: changed, signature }), keys)).json();
    expect(r.verified).toBe(false);
    expect(r.file_matches).toBe(false);
  });
  it("never leaks the key", async () => {
    const res = await handleDownload(post("/", { report }), { ...env, REPORT_SIGNING_KEY: "AAAA" }, open);
    expect(await res.text()).not.toContain("AAAA");
  });
});
