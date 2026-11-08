// MPC-9888: the browser half of the scan consent.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { __resetScanConsentForTests, adoptExistingConsent, getConsentId, giveScanConsent, hasScanConsent } from "./scanConsent";
import { browserContext } from "./recipientClient";
import { CONSENT_CONFIG } from "../../shared/recipients/consent-config";

const ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const reply = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

beforeEach(() => { __resetScanConsentForTests(); vi.restoreAllMocks(); });

describe("scan consent (browser)", () => {
  it("holds no consent until the button is pressed, and a scan_consent recipient then has no consent id", () => {
    expect(hasScanConsent()).toBe(false);
    expect(browserContext({}, "google-stun").consentId).toBeNull();            // STUN is refused without it
    expect(browserContext({}, "leads").consentId).toBe("user-action:no-scan-consent");   // a form submit is not covered by the scan consent
  });

  it("POSTs only the four allowed fields, keeps the id, and a second press writes nothing again", async () => {
    const f = vi.spyOn(globalThis, "fetch").mockImplementation(async () => reply(201, { consent_id: ID, consent_version: CONSENT_CONFIG.consent_version, consented_at: "2026-11-08T00:00:00Z" }));
    expect(await giveScanConsent("en")).toBe(ID);
    expect(await giveScanConsent("en")).toBe(ID);
    expect(f).toHaveBeenCalledTimes(1);
    const [url, init] = f.mock.calls[0] as [string, RequestInit];
    expect(String(url)).toMatch(/\/api\/consent$/);
    const body = JSON.parse(String(init.body));
    expect(Object.keys(body).sort()).toEqual(["consent_text_sha256", "consent_version", "locale", "scan_id"]);
    expect(hasScanConsent()).toBe(true);
    expect(getConsentId()).toBe(ID);
    expect(browserContext({}, "google-stun").consentId).toBe(ID);   // now STUN may run
  });

  it("a server refusal leaves no consent (nothing post-click may start)", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async () => reply(400, { error: "Unknown consent wording" }));
    await expect(giveScanConsent("en")).rejects.toMatchObject({ kind: "stale" });
    expect(hasScanConsent()).toBe(false);
  });

  it("portable consent: a journey that already consented on another door is adopted, not re-asked", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async () => reply(200, { consent_id: ID, consent_version: CONSENT_CONFIG.consent_version, consented_at: "2026-11-08T00:00:00Z" }));
    expect(await adoptExistingConsent("bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb")).toBe(true);
    expect(hasScanConsent()).toBe(true);
  });

  it("an older wording is not adopted", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async () => reply(200, { consent_id: ID, consent_version: "2026-01-v0", consented_at: "x" }));
    expect(await adoptExistingConsent("bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb")).toBe(false);
  });
});
