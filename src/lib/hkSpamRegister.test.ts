// MPC-7446: the one Supabase insert on "Done": insert only, no phone number, no read-back.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  EMAIL_RE,
  REGISTERED_STORAGE_KEY,
  REGISTRATIONS_ENDPOINT,
  buildRegistrationRow,
  insertRegistration,
  recallRegistration,
  rememberRegistration,
} from "./hkSpamRegister";
import { UTM_STORAGE_KEY } from "./hkSpamTrack";

const NOW = new Date("2026-10-11T06:30:00Z"); // Sunday 14:30 HKT

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
});
afterEach(() => vi.unstubAllGlobals());

describe("buildRegistrationRow", () => {
  it("has exactly the table columns, the computed protection date and no phone number", () => {
    sessionStorage.setItem(UTM_STORAGE_KEY, JSON.stringify({ utm_source: "fb", utm_campaign: "hk1" }));
    const row = buildRegistrationRow({ platform: "ios", lang: "zh", now: NOW });
    expect(Object.keys(row).sort()).toEqual(
      ["email", "language", "marketing_consent", "platform", "protection_date", "reminder_consent", "source_page", "utm_campaign", "utm_medium", "utm_source"].sort(),
    );
    expect(row).toMatchObject({
      platform: "ios",
      language: "yue",
      utm_source: "fb",
      utm_medium: null,
      utm_campaign: "hk1",
      email: null,
      reminder_consent: false,
      source_page: "/HongKongSpam",
    });
    expect(row.protection_date).toMatch(/^2026-10-\d{2}$/);
    expect(JSON.stringify(row)).not.toMatch(/phone|msisdn|tel/i);
  });

  it("keeps the email only together with consent", () => {
    const withConsent = buildRegistrationRow({ platform: "android", lang: "en", email: " me@example.com ", reminderConsent: true, now: NOW });
    expect(withConsent.email).toBe("me@example.com");
    expect(withConsent.reminder_consent).toBe(true);
    const noConsent = buildRegistrationRow({ platform: "android", lang: "en", email: "me@example.com", reminderConsent: false, now: NOW });
    expect(noConsent.email).toBeNull();
    expect(noConsent.reminder_consent).toBe(false);
    const bad = buildRegistrationRow({ platform: "android", lang: "en", email: "nope", reminderConsent: true, now: NOW });
    expect(bad.email).toBeNull();
    expect(bad.reminder_consent).toBe(false);
    expect(buildRegistrationRow({ platform: "other", lang: "en", now: NOW }).language).toBe("en");
  });

  it("marketing consent is separate, defaults false, and needs a valid address", () => {
    const base = { platform: "ios", lang: "en", now: NOW } as const;
    expect(buildRegistrationRow({ ...base, email: "me@example.com", reminderConsent: true }).marketing_consent).toBe(false);
    const m = buildRegistrationRow({ ...base, email: "me@example.com", marketingConsent: true });
    expect(m).toMatchObject({ email: "me@example.com", marketing_consent: true, reminder_consent: false });
    expect(buildRegistrationRow({ ...base, email: "nope", marketingConsent: true })).toMatchObject({ email: null, marketing_consent: false });
  });

  it("throws outside the holiday table rather than guessing a date", () => {
    expect(() => buildRegistrationRow({ platform: "ios", lang: "en", now: new Date("2031-01-01T00:00:00Z") })).toThrow();
  });

  it("EMAIL_RE accepts normal addresses only", () => {
    expect(EMAIL_RE.test("a@b.co")).toBe(true);
    expect(EMAIL_RE.test("a@b")).toBe(false);
    expect(EMAIL_RE.test("a b@c.com")).toBe(false);
  });
});

describe("insertRegistration", () => {
  const row = buildRegistrationRow({ platform: "ios", lang: "en", now: NOW });

  it("POSTs once to the table with Prefer: return=minimal (insert only, never selects the row back)", async () => {
    const f = vi.fn(async () => ({ ok: true, status: 201 }) as Response);
    vi.stubGlobal("fetch", f);
    expect(await insertRegistration(row)).toBe(true);
    expect(f).toHaveBeenCalledTimes(1);
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(REGISTRATIONS_ENDPOINT);
    expect(url).toMatch(/\/rest\/v1\/hk_spam_registrations$/);
    expect(url).not.toContain("select=");
    expect(init.method).toBe("POST");
    const headers = init.headers as Record<string, string>;
    expect(headers.Prefer).toBe("return=minimal");
    expect(JSON.parse(init.body as string)).toEqual(row);
  });

  it("returns false on an HTTP error or a network failure and never throws", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false, status: 401 }) as Response));
    expect(await insertRegistration(row)).toBe(false);
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("offline"); }));
    expect(await insertRegistration(row)).toBe(false);
  });
});

describe("remembered registration", () => {
  it("round-trips a date and ignores junk", () => {
    expect(recallRegistration()).toBeNull();
    rememberRegistration("2026-10-27");
    expect(recallRegistration()).toBe("2026-10-27");
    localStorage.setItem(REGISTERED_STORAGE_KEY, "garbage");
    expect(recallRegistration()).toBeNull();
  });
});
