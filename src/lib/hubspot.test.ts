// MPC-7300: HubSpot Forms client.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { submitHubSpotForm, consentFields, HUBSPOT_PORTAL_ID } from "./hubspot";

const mockFetch = (res: Partial<Response> & { jsonBody?: unknown }) =>
  vi.fn(async () => ({ ok: true, status: 200, json: async () => res.jsonBody ?? {}, ...res }) as unknown as Response);

describe("consentFields", () => {
  afterEach(() => vi.useRealTimers());
  it("emits midnight-UTC epoch millis for today and the given source", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-06T23:59:59Z"));
    expect(consentFields("contact_page")).toEqual({ consent_given_at: String(Date.UTC(2026, 9, 6)), consent_source: "contact_page" });
  });
});

describe("submitHubSpotForm", () => {
  beforeEach(() => {
    document.cookie = "hubspotutk=; expires=Thu, 01 Jan 1970 00:00:00 GMT";
    document.title = "Page title";
  });
  afterEach(() => vi.unstubAllGlobals());

  it("POSTs fields + context to the portal's form endpoint", async () => {
    document.cookie = "hubspotutk=abc%20123";
    const f = mockFetch({});
    vi.stubGlobal("fetch", f);
    await submitHubSpotForm({ formId: "guid-1", fields: { email: "a@b.co", source_tag: "t" }, pageName: "Named" });
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(`https://api.hsforms.com/submissions/v3/integration/submit/${HUBSPOT_PORTAL_ID}/guid-1`);
    expect(init.method).toBe("POST");
    const body = JSON.parse(init.body as string);
    expect(body.fields).toEqual([{ name: "email", value: "a@b.co" }, { name: "source_tag", value: "t" }]);
    expect(body.context).toMatchObject({ hutk: "abc 123", pageName: "Named", pageUri: window.location.href });
  });

  it("defaults pageName to document.title and falls back to window.hubspotutk", async () => {
    (window as unknown as { hubspotutk?: string }).hubspotutk = "from-window";
    const f = mockFetch({});
    vi.stubGlobal("fetch", f);
    await submitHubSpotForm({ formId: "g", fields: {} });
    const body = JSON.parse(((f.mock.calls[0] as unknown) as [string, RequestInit])[1].body as string);
    expect(body.context).toMatchObject({ hutk: "from-window", pageName: "Page title" });
    delete (window as unknown as { hubspotutk?: string }).hubspotutk;
  });

  it("throws HubSpot's message on a non-2xx response", async () => {
    vi.stubGlobal("fetch", mockFetch({ ok: false, status: 400, jsonBody: { message: "Invalid email" } }));
    await expect(submitHubSpotForm({ formId: "g", fields: {} })).rejects.toThrow("Invalid email");
  });

  it("falls back to the status code when the error body is not JSON", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false, status: 502, json: async () => { throw new Error("x"); } }) as unknown as Response));
    await expect(submitHubSpotForm({ formId: "g", fields: {} })).rejects.toThrow("HubSpot error 502");
  });
});
