// HK-only "Stop Spam" card for the homepage and the report page (MPC-7446).
// Hidden entirely until the /HongKongSpam launch flag is on (src/data/hkSpam.json) or this is an internal preview.
// Hong Kong visitors (Cloudflare country, or the manual override) see the card; everyone else sees a one-line
// "for Hong Kong numbers" note with an override.
import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { HK_SPAM_PATH, isHkSpamSurfaceEnabled } from "@/config/hkSpamPage";
import { HK_COPY } from "@/data/hkSpamCopy";
import { hasHongKongOverride, isHongKongVisitor, setHongKongOverride } from "@/lib/hkVisitor";
import { readInitialLang } from "@/lib/hkSpamPage";

type Placement = "home" | "report";

const HkStopSpamCard = ({ placement }: { placement: Placement }) => {
  const enabled = useMemo(isHkSpamSurfaceEnabled, []);
  const lang = useMemo(readInitialLang, []);
  const copy = HK_COPY[lang].card;
  const [state, setState] = useState<"loading" | "hk" | "other">("loading");

  useEffect(() => {
    if (!enabled) return;
    let alive = true;
    isHongKongVisitor().then((hk) => {
      if (alive) setState(hk ? "hk" : "other");
    });
    return () => {
      alive = false;
    };
  }, [enabled]);

  if (!enabled || state === "loading") return null;

  if (state === "other") {
    return (
      <p className="px-4 pb-6 text-center text-xs text-muted-foreground" lang={HK_COPY[lang].htmlLang} data-testid="hk-card-note">
        {copy.nonHkNote}{" "}
        <button
          type="button"
          className="underline hover:text-foreground"
          onClick={() => {
            setHongKongOverride(true);
            setState("hk");
          }}
        >
          {copy.nonHkButton}
        </button>
      </p>
    );
  }

  const href = `${HK_SPAM_PATH}?utm_source=mpt_site&utm_medium=hk_card&utm_campaign=${placement}`;
  return (
    <section className="px-4 pb-10" aria-labelledby={`hk-card-${placement}`} lang={HK_COPY[lang].htmlLang} data-testid="hk-card">
      <div className="mx-auto max-w-2xl rounded-2xl border border-surface-border bg-brand-soft p-5 text-center sm:p-8">
        <h2 id={`hk-card-${placement}`} className="mb-2 text-xl font-bold text-foreground sm:text-2xl">
          {copy.title}
        </h2>
        <p className="mb-5 text-sm text-muted-foreground sm:text-base">{copy.body}</p>
        <Button asChild>
          <Link to={href}>{copy.button}</Link>
        </Button>
        {hasHongKongOverride() && (
          <p className="mt-3 text-xs text-muted-foreground">
            <button
              type="button"
              className="underline hover:text-foreground"
              onClick={() => {
                setHongKongOverride(false);
                setState("other");
              }}
            >
              {copy.notHkButton}
            </button>
          </p>
        )}
      </div>
    </section>
  );
};

export default HkStopSpamCard;
