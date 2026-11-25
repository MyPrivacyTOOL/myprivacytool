// MPC-10790 (decision A, 2026-11-24): what proof the browser client hands the wrapper, by the recipient's own registry entry.
// Before: every browser key except google-stun got the fixed marker from page load, so ga4, cloudflare-web-analytics, pwned-passwords, ... passed check 4
// with no click. Now: scan_consent / analytics_consent recipients get ONLY the real consent id; user_action / service recipients may carry the marker, but only
// after a real (trusted) user action; pre_click recipients need nothing.
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { __resetScanConsentForTests, __seedScanConsentForTests } from "./scanConsent";
import { USER_ACTION_MARKER, __setUserActionForTests, afterUserAction, browserContext, hasUserAction } from "./recipientClient";

const REAL = "22222222-2222-4222-8222-222222222222";   // what __seedScanConsentForTests stores

beforeEach(() => { __resetScanConsentForTests(); __setUserActionForTests(false); });
afterEach(() => __setUserActionForTests(false));

const SCAN_OR_ANALYTICS = ["ga4", "cloudflare-web-analytics", "learning-events", "pwned-passwords", "google-stun"];
const USER_ACTION_OR_SERVICE = ["github-channel", "oauth-session", "deep-dive-api", "hubspot", "leads", "scan-report"];

describe("browserContext (MPC-10790)", () => {
  it("before any click: nothing carries the marker, for any recipient", () => {
    for (const k of [...SCAN_OR_ANALYTICS, ...USER_ACTION_OR_SERVICE, "supabase", "supabase-signups", "cloudflare-turnstile", "whoami"]) expect(browserContext({}, k).consentId, k).toBeNull();
    expect(browserContext({}).consentId).toBeNull();
  });

  it("after a user action but no Scan me: only user_action / service recipients (and the named browser form write) get the marker", () => {
    __setUserActionForTests(true);
    for (const k of USER_ACTION_OR_SERVICE) expect(browserContext({}, k).consentId, k).toBe(USER_ACTION_MARKER);
    expect(browserContext({}, "supabase-signups").consentId).toBe(USER_ACTION_MARKER);   // /newsletter and hk-spam sign-ups: each its own form submit
    expect(browserContext({}, "supabase").consentId, "the Workers' database entry needs the real id").toBeNull();
    for (const k of SCAN_OR_ANALYTICS) expect(browserContext({}, k).consentId, `${k} needs the real id`).toBeNull();
    expect(browserContext({}, "not-in-the-registry").consentId).toBeNull();
  });

  it("after Scan me: everyone carries the real consent id, never the marker", () => {
    __seedScanConsentForTests();
    for (const k of [...SCAN_OR_ANALYTICS, ...USER_ACTION_OR_SERVICE]) expect(browserContext({}, k).consentId, k).toBe(REAL);
  });

  it("pre_click recipients (the registry's named exceptions) carry nothing and are not refused for it", () => {
    expect(browserContext({}, "whoami").consentId).toBeNull();
    expect(browserContext({}, "cloudflare-turnstile").consentId).toBeNull();
  });
});

describe("user action tracking (MPC-10790)", () => {
  const send = (type: string, init: Record<string, unknown> = {}) => window.dispatchEvent(Object.assign(new Event(type, { bubbles: true }), init));

  it("a script-dispatched event is not a user action (isTrusted is false)", () => {
    // jsdom events built in script are untrusted, which is exactly the case this guards against
    send("click"); send("pointerdown"); send("submit");
    expect(hasUserAction()).toBe(false);
  });

  it("the Scan me consent counts as a user action; afterUserAction resolves at once then", async () => {
    __seedScanConsentForTests();
    expect(hasUserAction()).toBe(true);
    await afterUserAction();
  });

  it("afterUserAction waits until the first action, then resolves", async () => {
    let done = false;
    const p = afterUserAction().then(() => { done = true; });
    await Promise.resolve();
    expect(done).toBe(false);
    __setUserActionForTests(true);   // what a trusted click does
    await p;
    expect(done).toBe(true);
  });
});
