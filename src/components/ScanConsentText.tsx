// MPC-9888 (Open Tracker design 2.2): the consent block. The signed-off wording (A, 107 words), with {N} from config and one link to /what-we-see.
// There is no checkbox and no second click: pressing the button next to it IS the agreement, and the text says so.
import { Link } from "react-router-dom";
import { consentLocale } from "@/lib/scanConsent";
import { CONSENT_PATH, renderConsent, type ConsentLocale } from "../../shared/recipients/consent-text";

export default function ScanConsentText({ locale, className = "" }: { locale?: ConsentLocale; className?: string }) {
  const c = renderConsent(locale ?? consentLocale());
  return (
    <p data-testid="scan-consent-text" data-consent-version={c.consentVersion} lang={c.locale} dir={c.locale === "ar" ? "rtl" : undefined}
       className={`text-sm text-muted-foreground max-w-xl mx-auto ${className}`}>
      {c.before}
      <Link to={CONSENT_PATH} className="underline hover:text-foreground">{c.link}</Link>
      {c.after}
    </p>
  );
}

/** The button label in the visitor's language ("Scan me"). */
export const scanMeLabel = (locale?: ConsentLocale): string => renderConsent(locale ?? consentLocale()).button;
