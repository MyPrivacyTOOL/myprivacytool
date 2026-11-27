import { Link } from "react-router-dom";
import { legalBlocks } from "@/lib/legalBlocks";
import type { Locale } from "../../shared/recipients/disclosure";

// MPC-9894 (Open Tracker design section 5): the recipient lists on Privacy, Cookies and the DPA. Nothing here is typed by hand: every sentence comes from
// src/data/legalBlocks.generated.json, which scripts/render-privacy-from-registry.mjs writes from shared/recipients/recipients.json through
// renderDisclosure. To change who is named on a legal page, change the registry (the build regenerates the file; a test fails if it is stale).
// Non-English locales get the same blocks in English with a translation-pending note until the translations land.

const link = "text-brand underline hover:text-foreground";

export const TranslationNote = ({ locale = "en" }: { locale?: Locale }) => {
  const b = legalBlocks(locale);
  return b.translation_note ? (
    <p className="mb-4 rounded-md border border-surface-border bg-brand-soft p-3 text-sm text-muted-foreground" data-testid="translation-pending">{b.translation_note}</p>
  ) : null;
};

/** The one-sentence visit-log disclosure (design 3.5), with the raw-IP window from the registry. */
export const VisitLogSentence = ({ locale = "en" }: { locale?: Locale }) => (
  <span data-generated="visit-log">{legalBlocks(locale).privacy.visit_log_sentence}</span>
);

/** Privacy "Who receives your data": every live recipient in the registry, grouped by who they are. */
export const PrivacyRecipients = ({ locale = "en" }: { locale?: Locale }) => {
  const b = legalBlocks(locale).privacy;
  return (
    <div data-generated="privacy-recipients">
      <TranslationNote locale={locale} />
      <p className="text-muted-foreground">
        This is every outside party that can receive anything from this site, written from the same list the site itself checks every outgoing call against. A
        service that depends on a setting is called only where that setting is on. The complete list, with the basis and when each one runs, is on{" "}
        <Link to="/what-we-see" className={link}>What we see, and who else does</Link>.
      </p>
      {b.groups.map((g) => (
        <div key={g.party} data-generated-group={g.party}>
          <h3 className="mt-6 text-xl font-semibold text-foreground">{g.title}</h3>
          <p className="text-muted-foreground">{g.intro}</p>
          <ul className="mt-2 list-inside list-disc space-y-2 text-muted-foreground">
            {g.items.map((i) => <li key={i.key} data-recipient={i.key}>{i.text}</li>)}
          </ul>
        </div>
      ))}
      {b.switched_off.length > 0 && (
        <div data-generated-group="switched-off">
          <h3 className="mt-6 text-xl font-semibold text-foreground">Planned and not yet open</h3>
          <ul className="mt-2 list-inside list-disc space-y-2 text-muted-foreground">
            {b.switched_off.map((i) => <li key={i.key} data-recipient={i.key}>{i.text}</li>)}
          </ul>
        </div>
      )}
      {b.removed.length > 0 && (
        <p className="mt-4 text-muted-foreground">
          No longer used: {b.removed.map((r) => `${r.name} (ended ${r.until})`).join("; ")}.
        </p>
      )}
    </div>
  );
};

/** Cookies: the outside services your browser itself contacts. */
export const CookiesRecipients = ({ locale = "en" }: { locale?: Locale }) => {
  const b = legalBlocks(locale).cookies;
  return (
    <div data-generated="cookies-recipients">
      <TranslationNote locale={locale} />
      <ul className="mt-2 list-inside list-disc space-y-2 text-muted-foreground">
        {b.items.map((i) => <li key={i.key} data-recipient={i.key}>{i.text}</li>)}
        {b.switched_off.map((i) => <li key={i.key} data-recipient={i.key}>{i.text}</li>)}
      </ul>
    </div>
  );
};

/** DPA: the sub-processor rows. */
export const DpaSubProcessors = ({ locale = "en" }: { locale?: Locale }) => {
  const b = legalBlocks(locale).dpa;
  return (
    <>
      {b.sub_processors.map((sp) => (
        <tr key={sp.key} className="border-b border-border/60 align-top" data-recipient={sp.key}>
          <td className="py-2 pr-4 font-medium text-foreground">{sp.name}</td>
          <td className="py-2">{sp.purpose}. Kept: {sp.retention}.</td>
        </tr>
      ))}
    </>
  );
};
