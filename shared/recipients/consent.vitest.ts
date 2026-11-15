// MPC-9887: the consent store helpers and the server-side gate (wrapper check 4 fed from scan_consents).
import { describe, expect, it, vi } from "vitest";
import {
  CONSENT_CONFIG, consentColumnsForWebScan, currentRegistryHash, findConsentById, makeConsentVerifier, parseConsentRequest, recordConsent, requireConsent,
  type ConsentDb, type ConsentRow,
} from "./consent";
import { callRecipient, RecipientError } from "./outbound";
import { consentGateEnforced, workerRecipientContext, CONSENT_GATE_ACTIVE } from "./worker-ctx";
import { registryHash } from "./canonical.js";
import recipientsData from "./recipients.data.js";

const SCAN = "3f2b6c1e-8d4a-4e9b-9c11-7a5d2e0f4b10";
const SHA = "a".repeat(64);
const good = { scan_id: SCAN, consent_version: CONSENT_CONFIG.consent_version, consent_text_sha256: SHA, locale: "en" };

/** An in-memory scan_consents with PostgREST-like unique scan_id and id lookups. */
function memDb(opts: { failReads?: boolean } = {}): ConsentDb & { rows: ConsentRow[]; inserts: number } {
  const rows: ConsentRow[] = [];
  const db = {
    rows, inserts: 0,
    async select(path: string) {
      if (opts.failReads) throw new Error("db down");
      const q = new URLSearchParams(path.split("?")[1]);
      const sid = q.get("scan_id")?.replace("eq.", ""), id = q.get("id")?.replace("eq.", "");
      return rows.filter((r) => (!sid || r.scan_id === sid) && (!id || r.id === id));
    },
    async insert(_t: string, row: Record<string, unknown>) {
      db.inserts++;
      if (rows.some((r) => r.scan_id === row.scan_id)) throw Object.assign(new Error("dup"), { status: 409 });
      const r = { id: crypto.randomUUID(), ...row } as unknown as ConsentRow;
      rows.push(r);
      return r;
    },
  };
  return db;
}

describe("consent config", () => {
  it("is one place: version 2026-11-v1 and N = 7 days (168 hours, Chris 2026-11-08)", () => {
    expect(CONSENT_CONFIG).toEqual({ consent_version: "2026-11-v1", n_hours: 168 });
  });
});

describe("parseConsentRequest", () => {
  it("accepts exactly the four fields and lower-cases the scan id", () => {
    const r = parseConsentRequest({ ...good, scan_id: SCAN.toUpperCase() });
    expect(r).toEqual({ ok: true, value: { ...good, scan_id: SCAN } });
  });
  it("refuses unknown keys (nothing like an email or IP can ride along), a bad uuid, an unknown wording, a bad hash and a bad locale", () => {
    for (const bad of [{ ...good, email: "a@b.co" }, { ...good, ip: "203.0.113.9" }, { ...good, scan_id: "nope" }, { ...good, consent_version: "2026-10-v9" },
      { ...good, consent_text_sha256: "xyz" }, { ...good, locale: "english-us-long" }, { ...good, locale: undefined }, null, [], "x"]) {
      expect(parseConsentRequest(bad).ok).toBe(false);
    }
  });
});

describe("recordConsent", () => {
  it("stores the registry hash and N from the server, not from the browser", async () => {
    const db = memDb();
    const { created, row } = await recordConsent(db, good as never, () => new Date("2026-11-08T12:00:00Z"));
    expect(created).toBe(true);
    expect(row.n_hours).toBe(168);
    expect(row.registry_hash).toBe(await registryHash(recipientsData));
    expect(row.registry_hash).toBe(await currentRegistryHash());
    expect(row.consented_at).toBe("2026-11-08T12:00:00.000Z");
    expect(Object.keys(row).sort()).toEqual(["consent_text_sha256", "consent_version", "consented_at", "id", "locale", "n_hours", "registry_hash", "scan_id"]);
  });
  it("is one consent per scan id: the second POST returns the first and writes nothing (a channel may collect consent, never re-ask)", async () => {
    const db = memDb();
    const a = await recordConsent(db, good as never);
    const b = await recordConsent(db, { ...good, consent_text_sha256: "b".repeat(64) } as never);
    expect(b.created).toBe(false);
    expect(b.row.id).toBe(a.row.id);
    expect(b.row.consent_text_sha256).toBe(SHA);
    expect(db.rows.length).toBe(1);
  });
  it("two simultaneous POSTs race to one row: the insert that loses gets the winner's row", async () => {
    const db = memDb();
    const realSelect = db.select.bind(db);
    let first = true;
    db.select = async (p: string) => { if (first && p.startsWith("scan_consents?scan_id")) { first = false; return []; } return realSelect(p); };   // the pre-check misses, the insert 409s
    await db.insert("scan_consents", { scan_id: SCAN });
    const r = await recordConsent(db, good as never);
    expect(r.created).toBe(false);
    expect(db.rows.length).toBe(1);
  });
  it("a database error other than a duplicate propagates", async () => {
    const db = memDb(); db.insert = async () => { throw Object.assign(new Error("x"), { status: 500 }); };
    await expect(recordConsent(db, good as never)).rejects.toThrow();
  });
});

describe("requireConsent and the verifier", () => {
  it("requireConsent returns the row for a consented scan and refuses CONSENT_REQUIRED otherwise", async () => {
    const db = memDb();
    await expect(requireConsent(db, SCAN)).rejects.toMatchObject({ code: "CONSENT_REQUIRED" });
    await expect(requireConsent(db, null)).rejects.toBeInstanceOf(RecipientError);
    const { row } = await recordConsent(db, good as never);
    await expect(requireConsent(db, SCAN)).resolves.toMatchObject({ id: row.id });
  });
  it("the verifier accepts a stored consent id and rejects an unknown one; an unreadable store fails closed", async () => {
    const db = memDb();
    const { row } = await recordConsent(db, good as never);
    expect(await makeConsentVerifier(db)(row.id)).toBe(true);
    expect(await makeConsentVerifier(db)(crypto.randomUUID())).toBe(false);
    expect(await makeConsentVerifier(db)("not-a-uuid")).toBe(false);
    expect(await makeConsentVerifier(memDb({ failReads: true }))(row.id)).toBe(false);
  });
  it("findConsentById ignores a malformed id without querying", async () => {
    const db = memDb(); const spy = vi.spyOn(db, "select");
    expect(await findConsentById(db, "1; drop table scan_consents")).toBeNull();
    expect(spy).not.toHaveBeenCalled();
  });
  it("consentColumnsForWebScan copies exactly the design 2.3 fields and nothing personal", async () => {
    const { row } = await recordConsent(memDb(), good as never);
    const cols = consentColumnsForWebScan(row);
    expect(Object.keys(cols).sort()).toEqual(["consent_id", "consent_locale", "consent_n_hours", "consent_registry_hash", "consent_text_sha256", "consent_version", "consented_at"]);
  });
});

// ---- the gate end to end: workerRecipientContext -> wrapper check 4 -> the store ----
const SB = "https://x.supabase.co";
function storeFetch(db: ConsentDb & { rows: ConsentRow[] }) {
  return vi.fn(async (url: string | URL) => {
    const u = String(url);
    if (u.includes("/rest/v1/scan_consents")) return new Response(JSON.stringify(await db.select(u.split("/rest/v1/")[1])), { status: 200 });
    return new Response("{}", { status: 200 });
  }) as unknown as typeof fetch & ReturnType<typeof vi.fn>;
}
const codeOf = async (p: Promise<unknown>) => { try { await p; return "no error"; } catch (e) { return e instanceof RecipientError ? e.code : `other: ${e}`; } };
const env = { SUPABASE_URL: SB, SUPABASE_SERVICE_ROLE_KEY: "svc", CONSENT_GATE_ENFORCED: "true" };
const resend = (ctx: ReturnType<typeof workerRecipientContext>) => callRecipient("resend", { url: "https://api.resend.com/emails", sent: ["email"] }, ctx);

describe("the server-side gate (wrapper check 4)", () => {
  it("the gate machinery is active and the switch is the exact string true", () => {
    expect(CONSENT_GATE_ACTIVE).toBe(true);
    expect(consentGateEnforced({ CONSENT_GATE_ENFORCED: "true" })).toBe(true);
    for (const v of ["false", "TRUE", "1", true, undefined]) expect(consentGateEnforced({ CONSENT_GATE_ENFORCED: v as never })).toBe(false);
    expect(consentGateEnforced(null)).toBe(false);
  });
  it("enforced: a post_click call without a consent id is refused, and the network is never reached", async () => {
    const f = storeFetch(memDb());
    expect(await codeOf(resend(workerRecipientContext(env, { fetchImpl: f, scanId: "scan-1" })))).toBe("CONSENT_REQUIRED");
    expect(f).not.toHaveBeenCalled();
  });
  it("enforced: a consent id with no row in the store is refused CONSENT_INVALID; the only call made is the read of the store", async () => {
    const f = storeFetch(memDb());
    expect(await codeOf(resend(workerRecipientContext(env, { fetchImpl: f, scanId: "scan-1", consentId: crypto.randomUUID() })))).toBe("CONSENT_INVALID");
    expect(f.mock.calls.every((c) => String(c[0]).includes("/rest/v1/scan_consents"))).toBe(true);
    expect(f.mock.calls.some((c) => String(c[0]).includes("api.resend.com"))).toBe(false);
  });
  it("enforced: a call without a consent row is refused, with one it goes through", async () => {
    const db = memDb(); const f = storeFetch(db);
    const { row } = await recordConsent(db, good as never);
    expect(await codeOf(resend(workerRecipientContext(env, { fetchImpl: f, scanId: "scan-1", consentId: row.id })))).toBe("no error");
    expect(f.mock.calls.some((c) => String(c[0]).includes("api.resend.com"))).toBe(true);
    db.rows.length = 0;   // the free user's record was deleted
    expect(await codeOf(resend(workerRecipientContext(env, { fetchImpl: storeFetch(db), scanId: "scan-1", consentId: row.id })))).toBe("CONSENT_INVALID");
  });
  it("a store that cannot be read refuses (fails closed)", async () => {
    const f = vi.fn(async () => new Response("boom", { status: 500 })) as unknown as typeof fetch;
    expect(await codeOf(resend(workerRecipientContext(env, { fetchImpl: f, scanId: "scan-1", consentId: crypto.randomUUID() })))).toBe("CONSENT_INVALID");
  });
  it("enforced: pre_click first-party calls still work with no consent", async () => {
    const f = storeFetch(memDb());
    const ctx = workerRecipientContext(env, { fetchImpl: f, scanId: "scan-1" });
    expect(await codeOf(callRecipient("whoami", { url: "https://api.myprivacytool.io/whoami", sent: ["ip", "country", "city", "device_profile"] }, ctx))).toBe("no error");
    expect(await codeOf(callRecipient("hk-geo", { url: "https://www.myprivacytool.io/api/hk-geo", sent: ["ip", "country"] }, ctx))).toBe("no error");
  });
  it("not enforced and no consent id: nothing changes (check 4 skipped), but a consent id the scan carries is still verified", async () => {
    const off = { ...env, CONSENT_GATE_ENFORCED: "false" };
    expect(workerRecipientContext(off, { fetchImpl: storeFetch(memDb()), scanId: "scan-1" }).consentGate).toBe("none");
    expect(await codeOf(resend(workerRecipientContext(off, { fetchImpl: storeFetch(memDb()), scanId: "scan-1" })))).toBe("no error");
    expect(await codeOf(resend(workerRecipientContext(off, { fetchImpl: storeFetch(memDb()), scanId: "scan-1", consentId: crypto.randomUUID() })))).toBe("CONSENT_INVALID");
  });
  it("outside a scan (no scan id: cron collectors, ops notifications) there is no consent to present, enforced or not", async () => {
    const ctx = workerRecipientContext(env, { fetchImpl: storeFetch(memDb()) });
    expect(ctx.consentGate).toBe("none");
    expect(await codeOf(resend(ctx))).toBe("no error");
  });
  it("only the wrapper's own none/enforce policy turns check 4 off: every other check still refuses under enforcement", async () => {
    const db = memDb(); const { row } = await recordConsent(db, good as never);
    const ctx = workerRecipientContext(env, { fetchImpl: storeFetch(db), scanId: "scan-1", consentId: row.id });
    expect(await codeOf(callRecipient("resend", { url: "https://evil.example/emails", sent: ["email"] }, ctx))).toBe("HOST_MISMATCH");
    expect(await codeOf(callRecipient("resend", { url: "https://api.resend.com/emails", sent: ["password_hash_prefix"] }, ctx))).toBe("DATA_ITEM_NOT_ALLOWED");
  });
});
