import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import Seo from "@/components/Seo";
import pageMeta from "@/data/pageMeta.json";
import { RECIPIENTS, RECIPIENT_LIST } from "@/config/recipients";
import { registryHash } from "../../shared/recipients/canonical.js";
import {
  LOCALES, LOCALE_NAMES, PARTY_ORDER, RTL_LOCALES, describeEntry, isLive, isRemoved, isLocale, registryDate, partyLabel, t, toLocale, type Locale,
} from "../../shared/recipients/disclosure";

// MPC-9893 (Open Tracker design 1.6, rules 1 and 2): /what-we-see. A static page rendered from shared/recipients/recipients.json and nothing else: every
// outside party that can ever receive anything from this site, grouped by who they are, with what they see, why, for how long, on what basis and
// when it runs (page load, or only after Scan me). Entries that have ended are listed separately with the date they ended. The registry hash and date
// at the bottom let anyone check that this page matches the file the code enforces.
//
// Nothing here is typed by hand: add, switch off or end a recipient in the registry and this page follows. The words for each row come from describeEntry
// in shared/recipients/disclosure.ts, the same function the per-scan panel uses.

const todayIso = (): string => new Date().toISOString().slice(0, 10);

export default function WhatWeSee({ today = todayIso() }: { today?: string }) {
  const [params, setParams] = useSearchParams();
  const asked = params.get("lang");
  const locale: Locale = isLocale(asked) ? asked : toLocale(typeof navigator !== "undefined" ? navigator.language : "en");
  const dir = RTL_LOCALES.includes(locale) ? "rtl" : "ltr";
  const [hash, setHash] = useState<string>("");

  useEffect(() => {
    let live = true;
    void registryHash(RECIPIENTS).then((h: string) => { if (live) setHash(h); }).catch(() => { if (live) setHash("unavailable"); });
    return () => { live = false; };
  }, []);

  const live = useMemo(() => RECIPIENT_LIST.filter((r) => isLive(r, today)), [today]);
  const removed = useMemo(() => RECIPIENT_LIST.filter((r) => isRemoved(r, today)).sort((a, b) => String(b.until).localeCompare(String(a.until))), [today]);
  const date = useMemo(() => registryDate(RECIPIENT_LIST), []);
  const groups = PARTY_ORDER.map((party) => ({ party, entries: live.filter((r) => r.party === party) })).filter((g) => g.entries.length > 0);
  const anyEnglishFallback = locale !== "en" && live.some((r) => !r.disclosure?.[locale]);

  return (
    <>
      <Seo {...pageMeta["/what-we-see"]} path="/what-we-see" />
      <main className="min-h-screen bg-background" dir={dir} lang={locale} data-testid="what-we-see">
        <div className="mx-auto max-w-5xl px-4 py-16 sm:px-6 lg:px-8">
          <h1 className="mb-2 text-4xl font-bold text-foreground">What we see, and who else does</h1>
          <p className="mb-6 max-w-3xl text-lg text-muted-foreground">
            MyPrivacyTOOL does what trackers do, in the open. This is the complete list of every outside party that can receive anything from this site, what each one
            sees, why, for how long, and when it runs. Nothing outside this list is contacted: the site checks every outgoing call against it.
          </p>
          <label className="mb-8 flex items-center gap-2 text-sm text-muted-foreground">
            <span>Language</span>
            <select
              className="rounded-md border border-surface-border bg-background px-2 py-1 text-foreground"
              value={locale}
              onChange={(e) => setParams(e.target.value === "en" ? {} : { lang: e.target.value }, { replace: true })}
              data-testid="what-we-see-language"
            >
              {LOCALES.map((l) => <option key={l} value={l}>{LOCALE_NAMES[l]}</option>)}
            </select>
          </label>
          {anyEnglishFallback && (
            <p className="mb-6 rounded-md border border-surface-border bg-brand-soft p-3 text-sm text-muted-foreground" data-testid="what-we-see-fallback">
              The column headings and data names are shown in {LOCALE_NAMES[locale]}. The one-line reasons are still in English until they are translated.
            </p>
          )}

          {groups.map(({ party, entries }) => (
            <section key={party} className="mb-10" aria-labelledby={`party-${party}`} data-testid={`group-${party}`}>
              <h2 id={`party-${party}`} className="mb-3 text-2xl font-semibold text-foreground">{partyLabel(party, locale)}</h2>
              <div className="overflow-x-auto rounded-lg border border-surface-border">
                <table className="w-full min-w-[56rem] border-collapse text-sm">
                  <thead className="bg-muted text-start text-muted-foreground">
                    <tr>
                      {(["who", "sees", "why", "howLong", "basis", "when"] as const).map((k) => (
                        <th key={k} scope="col" className="px-3 py-2 text-start font-medium">{t(locale, k)}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {entries.map((r) => {
                      const p = describeEntry(r, locale);
                      return (
                        <tr key={r.key} className="border-t border-surface-border align-top" data-testid="recipient-row" data-recipient={r.key} data-phase={r.phase}>
                          <th scope="row" className="px-3 py-2 text-start font-medium text-foreground">{p.who}</th>
                          <td className="px-3 py-2 text-foreground">{p.sees}</td>
                          <td className="px-3 py-2 text-foreground">{p.why}</td>
                          <td className="px-3 py-2 text-foreground">{p.howLong}</td>
                          <td className="px-3 py-2 text-foreground">{p.basis}</td>
                          <td className="px-3 py-2 text-foreground" data-testid="recipient-when">{p.when}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </section>
          ))}

          <section className="mb-10" aria-labelledby="removed-heading" data-testid="removed-section">
            <h2 id="removed-heading" className="mb-3 text-2xl font-semibold text-foreground">No longer used</h2>
            {removed.length === 0 ? (
              <p className="text-sm text-muted-foreground">No recipient has been removed yet. When one is, it stays here with the date it ended.</p>
            ) : (
              <ul className="space-y-2 text-sm text-foreground">
                {removed.map((r) => (
                  <li key={r.key} data-testid="removed-row" data-recipient={r.key}>
                    <span className="font-medium">{r.name}</span> <span className="text-muted-foreground">(ended {r.until})</span>: {describeEntry(r, locale).why}
                  </li>
                ))}
              </ul>
            )}
          </section>

          <footer className="border-t border-surface-border pt-4 text-xs text-muted-foreground" data-testid="registry-stamp">
            <p>
              Registry date <span data-testid="registry-date">{date}</span>. Registry fingerprint (SHA-256) <code className="break-all" data-testid="registry-hash">{hash || "…"}</code>.
            </p>
            <p className="mt-1">This page is generated from the same file the site checks every outgoing call against.</p>
          </footer>
        </div>
      </main>
    </>
  );
}
