import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildWaitlistRow, insertWaitlist, WAITLIST_ENDPOINT, recallWaitlist, rememberWaitlist } from "./hkShieldWaitlist";

vi.mock("@/lib/recipientClient", () => ({ recipientFetch: vi.fn() }));
import { recipientFetch } from "@/lib/recipientClient";

const ok = { email: "a@b.hk", consent: true, platform: "android" as const, lang: "en" as const };

describe("Spam Shield waitlist row (CK-11387)", () => {
  beforeEach(() => {
    window.history.replaceState({}, "", "/HongKongSpam?utm_source=facebook-group&utm_medium=organic&utm_campaign=hk-spam-w1");
    sessionStorage.clear();
    localStorage.clear();
    vi.mocked(recipientFetch).mockReset();
  });
  afterEach(() => window.history.replaceState({}, "", "/"));

  it("builds the row with consent, utm and no phone number", () => {
    const row = buildWaitlistRow(ok);
    expect(row).toEqual({
      language: "en", platform: "android", email: "a@b.hk", consent: true,
      utm_source: "facebook-group", utm_medium: "organic", utm_campaign: "hk-spam-w1", source_page: "/HongKongSpam",
    });
    expect(Object.keys(row!)).not.toContain("phone");
  });

  it("stores nothing without consent or with a bad address", () => {
    expect(buildWaitlistRow({ ...ok, consent: false })).toBeNull();
    expect(buildWaitlistRow({ ...ok, email: "nope" })).toBeNull();
    expect(buildWaitlistRow({ ...ok, email: `${"a".repeat(250)}@b.hk` })).toBeNull();
  });

  it("maps Traditional Chinese to the yue language value", () => {
    expect(buildWaitlistRow({ ...ok, lang: "zh" })!.language).toBe("yue");
  });

  it("insert: 201 = saved, 409 = duplicate (already on the list), anything else or a throw = error", async () => {
    const row = buildWaitlistRow(ok)!;
    vi.mocked(recipientFetch).mockResolvedValueOnce({ ok: true, status: 201 } as Response);
    expect(await insertWaitlist(row)).toBe("saved");
    vi.mocked(recipientFetch).mockResolvedValueOnce({ ok: false, status: 409 } as Response);
    expect(await insertWaitlist(row)).toBe("duplicate");
    vi.mocked(recipientFetch).mockResolvedValueOnce({ ok: false, status: 500 } as Response);
    expect(await insertWaitlist(row)).toBe("error");
    vi.mocked(recipientFetch).mockRejectedValueOnce(new Error("offline"));
    expect(await insertWaitlist(row)).toBe("error");
  });

  it("posts insert-only to hk_shield_waitlist with return=minimal and never reads back", async () => {
    vi.mocked(recipientFetch).mockResolvedValueOnce({ ok: true, status: 201 } as Response);
    await insertWaitlist(buildWaitlistRow(ok)!);
    const [name, url, init] = vi.mocked(recipientFetch).mock.calls[0];
    expect(name).toBe("supabase");
    expect(url).toBe(WAITLIST_ENDPOINT);
    expect(url).toMatch(/\/rest\/v1\/hk_shield_waitlist$/);
    expect((init as RequestInit).method).toBe("POST");
    expect(((init as RequestInit).headers as Record<string, string>).Prefer).toBe("return=minimal");
  });

  it("remembers a signup on this device", () => {
    expect(recallWaitlist()).toBe(false);
    rememberWaitlist();
    expect(recallWaitlist()).toBe(true);
  });
});
