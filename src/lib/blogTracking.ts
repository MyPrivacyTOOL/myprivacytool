// Blog engagement helpers (Blog Deployment Runbook step 6). Pure functions so they can be unit-tested
// without a DOM; the GA4 events themselves are emitted by the trackBlog* functions in analytics.ts.

export const BLOG_SCROLL_THRESHOLDS = [25, 50, 75, 100] as const;

// Internal destinations that count as a blog call to action. Links to other posts (/blog/...) are
// counted too, as cross-linking is part of the funnel; in-page anchors and external links are not.
export const CTA_DESTINATIONS = [
  "/scan",
  "/start",
  "/pricing",
  "/newsletter",
  "/business",
  "/enterprise",
  "/am-i-exposed",
  "/ai-access-check",
] as const;

/** Percent (0-100) of the article that has scrolled into view, from the article's viewport rect. */
export function scrollDepthPercent(articleTop: number, articleHeight: number, viewportHeight: number): number {
  if (articleHeight <= 0) return 0;
  const pct = ((viewportHeight - articleTop) / articleHeight) * 100;
  return Math.max(0, Math.min(100, Math.round(pct)));
}

/** Thresholds reached at this depth that have not been reported yet. */
export function newlyReachedThresholds(percent: number, alreadyFired: ReadonlySet<number>): number[] {
  return BLOG_SCROLL_THRESHOLDS.filter((t) => percent >= t && !alreadyFired.has(t));
}

/** Internal path (no query or hash) if the href is a blog call to action, otherwise null. */
export function blogCtaDestination(href: string | null | undefined): string | null {
  if (!href || !href.startsWith("/") || href.startsWith("//")) return null;
  const path = href.split(/[?#]/)[0].replace(/\/+$/, "") || "/";
  if ((CTA_DESTINATIONS as readonly string[]).includes(path)) return path;
  if (path.startsWith("/blog/")) return path;
  return null;
}
