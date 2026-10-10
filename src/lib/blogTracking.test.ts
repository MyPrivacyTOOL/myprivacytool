import { afterEach, describe, expect, it, vi } from "vitest";
import { blogCtaDestination, newlyReachedThresholds, scrollDepthPercent } from "./blogTracking";
import {
  trackBlogCtaClick,
  trackBlogListView,
  trackBlogPostClick,
  trackBlogPostView,
  trackBlogScrollDepth,
} from "./analytics";

describe("scrollDepthPercent", () => {
  it("is 0 while the article is still below the fold", () => {
    expect(scrollDepthPercent(900, 3000, 800)).toBe(0);
  });
  it("counts how much of the article has come into view", () => {
    // article top is 200px below the viewport top, viewport is 800px tall -> 600px of 3000 seen
    expect(scrollDepthPercent(200, 3000, 800)).toBe(20);
    expect(scrollDepthPercent(-1000, 3000, 800)).toBe(60);
  });
  it("caps at 100 and tolerates an empty article", () => {
    expect(scrollDepthPercent(-5000, 3000, 800)).toBe(100);
    expect(scrollDepthPercent(0, 0, 800)).toBe(0);
  });
});

describe("newlyReachedThresholds", () => {
  it("reports each threshold once", () => {
    const fired = new Set<number>();
    expect(newlyReachedThresholds(10, fired)).toEqual([]);
    expect(newlyReachedThresholds(55, fired)).toEqual([25, 50]);
    [25, 50].forEach((t) => fired.add(t));
    expect(newlyReachedThresholds(60, fired)).toEqual([]);
    expect(newlyReachedThresholds(100, fired)).toEqual([75, 100]);
  });
});

describe("blogCtaDestination", () => {
  it("accepts the conversion destinations and strips query and hash", () => {
    expect(blogCtaDestination("/scan?utm_source=blog&utm_medium=x")).toBe("/scan");
    expect(blogCtaDestination("/newsletter")).toBe("/newsletter");
    expect(blogCtaDestination("/pricing/#plans")).toBe("/pricing");
  });
  it("accepts links to other blog posts", () => {
    expect(blogCtaDestination("/blog/how-exposed-are-you")).toBe("/blog/how-exposed-are-you");
  });
  it("ignores anchors, external links, the blog index and everything else", () => {
    expect(blogCtaDestination("#faq")).toBeNull();
    expect(blogCtaDestination("https://example.com/scan")).toBeNull();
    expect(blogCtaDestination("//example.com/scan")).toBeNull();
    expect(blogCtaDestination("/blog")).toBeNull();
    expect(blogCtaDestination("/privacy")).toBeNull();
    expect(blogCtaDestination(null)).toBeNull();
    expect(blogCtaDestination(undefined)).toBeNull();
  });
});

describe("blog GA4 events", () => {
  afterEach(() => {
    delete window.gtag;
  });

  it("emits the funnel events with the agreed names and parameters", () => {
    const gtag = vi.fn();
    window.gtag = gtag;
    trackBlogListView(8);
    trackBlogPostClick("how-exposed-are-you", "Privacy Awareness", 5);
    trackBlogPostView("how-exposed-are-you", "Privacy Awareness", 8);
    trackBlogScrollDepth("how-exposed-are-you", 50);
    trackBlogCtaClick("how-exposed-are-you", "end_of_post", "/scan");
    expect(gtag.mock.calls).toEqual([
      ["event", "blog_list_view", { post_count: 8 }],
      ["event", "blog_post_click", { post_slug: "how-exposed-are-you", category: "Privacy Awareness", position: 5 }],
      ["event", "blog_post_view", { post_slug: "how-exposed-are-you", category: "Privacy Awareness", read_time_minutes: 8 }],
      ["event", "blog_scroll_depth", { post_slug: "how-exposed-are-you", percent_scrolled: 50 }],
      ["event", "blog_cta_click", { post_slug: "how-exposed-are-you", cta_location: "end_of_post", destination: "/scan" }],
    ]);
  });

  it("does nothing, and does not throw, when gtag is absent (blocked or no consent)", () => {
    delete window.gtag;
    expect(() => trackBlogPostView("x", "y", 1)).not.toThrow();
  });
});
