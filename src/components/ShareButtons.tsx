import { useState } from "react";
import { Button } from "@/components/ui/button";
import { trackShare } from "@/lib/analytics";
import { SHARE_SUBJECT, SHARE_TEXT, shareLinks, shareUrl } from "@/lib/share";

// MPC-8451: "Know someone who should check too?" Plain links (no third-party scripts), the native share sheet where the browser has one, and
// copy link. Shares carry only the public scan page. First-draft wording, needs Chris's approval.
export default function ShareButtons({ where }: { where: "scan_page" | "thank_you" }) {
  const [copied, setCopied] = useState(false);
  const canNativeShare = typeof navigator !== "undefined" && typeof navigator.share === "function";

  const native = async () => {
    trackShare("native", where);
    try {
      await navigator.share({ title: SHARE_SUBJECT, text: SHARE_TEXT, url: shareUrl("native") });
    } catch {
      /* the visitor closed the share sheet: nothing to do */
    }
  };

  const copy = async () => {
    trackShare("copy", where);
    const url = shareUrl("copy");
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2500);
    } catch {
      window.prompt("Copy this link", url); // clipboard blocked: let the visitor copy it by hand
    }
  };

  return (
    <section aria-labelledby={`share-title-${where}`} className="mt-8" data-testid="share-buttons">
      <h2 id={`share-title-${where}`} className="mb-3 text-sm font-semibold text-foreground">Know someone who should check too?</h2>
      <div className="flex flex-wrap items-center justify-center gap-2">
        {canNativeShare && <Button type="button" variant="outline" size="sm" onClick={native}>Share</Button>}
        {shareLinks().map((l) => (
          <Button key={l.id} asChild variant="outline" size="sm">
            <a href={l.href} target="_blank" rel="noopener noreferrer" onClick={() => trackShare(l.id, where)}>{l.label}</a>
          </Button>
        ))}
        <Button type="button" variant="outline" size="sm" onClick={copy}>Copy link</Button>
      </div>
      <p aria-live="polite" className="mt-2 h-4 text-xs text-muted-foreground">{copied ? "Link copied" : ""}</p>
    </section>
  );
}
