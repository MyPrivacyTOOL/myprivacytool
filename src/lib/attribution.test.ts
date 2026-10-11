import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { captureAttribution, getAttribution, parseAttribution, resetAttributionForTests } from "./attribution";

describe("attribution", () => {
  beforeEach(resetAttributionForTests);

  it("parses utm params and ignores the rest", () => {
    expect(parseAttribution("?utm_source=blog&utm_campaign=mpc-7033-w02&x=1")).toEqual({
      utm_source: "blog",
      utm_campaign: "mpc-7033-w02",
    });
    expect(parseAttribution("")).toEqual({});
  });

  it("caps value length", () => {
    expect(parseAttribution(`?utm_source=${"a".repeat(300)}`).utm_source).toHaveLength(100);
  });

  it("keeps the first touch and does not overwrite it", () => {
    captureAttribution("?utm_source=x&utm_campaign=mpc-7033-w01");
    captureAttribution("?utm_source=blog&utm_medium=some-post");
    expect(getAttribution()).toEqual({ utm_source: "x", utm_campaign: "mpc-7033-w01" });
  });

  it("ignores URLs without utm_source", () => {
    captureAttribution("?utm_medium=orphan");
    expect(getAttribution()).toEqual({});
  });
});

describe("lead events carry attribution (MPC-7376)", () => {
  beforeEach(() => {
    resetAttributionForTests();
    window.gtag = vi.fn();
  });
  afterEach(() => {
    delete window.gtag;
  });

  it("adds first-touch utm params to the form event and generate_lead", async () => {
    captureAttribution("?utm_source=blog&utm_campaign=mpc-7033-w02");
    const { trackNewsletterSignup } = await import("./analytics");
    trackNewsletterSignup({ source: "newsletter_page" });
    const calls = (window.gtag as ReturnType<typeof vi.fn>).mock.calls;
    expect(calls.map((c) => c[1])).toEqual(["newsletter_signup", "generate_lead"]);
    for (const c of calls) {
      expect(c[2]).toMatchObject({ utm_source: "blog", utm_campaign: "mpc-7033-w02", source: "newsletter_page" });
    }
  });
});
