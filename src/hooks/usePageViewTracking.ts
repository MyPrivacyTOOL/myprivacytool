import { useEffect, useRef } from "react";
import { useLocation } from "react-router-dom";
import { trackPageView } from "@/lib/analytics";

// MPC-7376 / #233: GA4 Enhanced measurement is OFF for this property, so React Router navigations are not
// reported. The initial page is already sent by gtag('config') in index.html once the visitor consents, so
// this hook skips the first render and reports every later route change. The short delay lets react-helmet
// update document.title first, so GA4 records the new page's title.
export const PAGE_VIEW_DELAY_MS = 150;

export function usePageViewTracking(): void {
  const { pathname, search } = useLocation();
  const first = useRef(true);

  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    const t = setTimeout(trackPageView, PAGE_VIEW_DELAY_MS);
    return () => clearTimeout(t);
  }, [pathname, search]);
}
