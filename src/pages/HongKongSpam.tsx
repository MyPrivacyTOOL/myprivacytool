// /HongKongSpam: bilingual (English + Traditional Chinese, Hong Kong usage) one-tap landing page for the OFCA
// Do-not-call registers (MPC-7446). Builds on the MPC-7450 engine: src/config/hkDnc.ts, src/lib/hkWorkingDays.ts,
// src/lib/hkSpamTrack.ts. IVR_VERIFIED is false until MPC-7445, so the public page never lists menu keys or says
// they auto-send; an internal preview shows the placeholders under an "unverified" banner.
import { useEffect, useMemo, useState } from "react";
import { Helmet } from "react-helmet";
import { Link, Navigate, useLocation } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import Seo, { SITE_URL } from "@/components/Seo";
import { HK_SPAM_ENABLED } from "@/config/hkDnc";
import { HK_SPAM_INDEXABLE, HK_SPAM_META, HK_SPAM_PATH, isHkSpamPreview } from "@/config/hkSpamPage";
import { CONSENT_WORDING_FINAL, HK_COPY, type HkCopy } from "@/data/hkSpamCopy";
import { hasHongKongOverride, isHongKongVisitor, setHongKongOverride } from "@/lib/hkVisitor";
import { track, getUtm } from "@/lib/hkSpamTrack";
import { formatHkDate, readInitialLang, resolveHkDial, detectHkPlatform, storeLang, type PageLang } from "@/lib/hkSpamPage";
import {
  EMAIL_RE,
  buildRegistrationRow,
  insertRegistration,
  recallRegistration,
  rememberRegistration,
} from "@/lib/hkSpamRegister";
import {
  addSpamLogEntry,
  clearSpamLog,
  downloadSpamLog,
  loadSpamLog,
  removeSpamLogEntry,
  SPAM_KINDS,
  spamKindLabel,
  spamLogToText,
  type SpamKind,
} from "@/lib/hkSpamLog";
import { buildOptOutText, SENDER_TYPES, type OptOutChannel, type SenderType } from "@/lib/hkSpamOptOut";

const SELECT_CLASS = "h-11 w-full rounded-md border border-input bg-background px-3 text-base text-foreground";

async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

function buildJsonLd(copy: HkCopy, stepList: { title: string; body: string }[]) {
  return [
    {
      "@context": "https://schema.org",
      "@type": "FAQPage",
      mainEntity: copy.faqs.map(({ q, a }) => ({
        "@type": "Question",
        name: q,
        acceptedAnswer: { "@type": "Answer", text: a },
      })),
    },
    {
      "@context": "https://schema.org",
      "@type": "HowTo",
      name: copy.heroTitle,
      description: copy.heroSub,
      totalTime: "PT1M",
      step: stepList.map((s, i) => ({ "@type": "HowToStep", position: i + 1, name: s.title, text: s.body })),
    },
  ];
}

const HongKongSpamPage = () => {
  const [lang, setLang] = useState<PageLang>(readInitialLang);
  const copy = HK_COPY[lang];
  const platform = useMemo(
    () => (typeof navigator === "undefined" ? "other" : detectHkPlatform(navigator.userAgent, navigator.maxTouchPoints ?? 0)),
    [],
  );
  const preview = useMemo(isHkSpamPreview, []);
  const view = resolveHkDial(platform, lang, preview);

  // Registration
  const [email, setEmail] = useState("");
  const [consent, setConsent] = useState(false);
  const [formError, setFormError] = useState("");
  const recalled = useMemo(recallRegistration, []);
  const [status, setStatus] = useState<"idle" | "saving" | "done" | "error">(recalled ? "done" : "idle");
  const [protectionDate, setProtectionDate] = useState<string | null>(recalled);
  const [saved, setSaved] = useState<boolean | null>(null);
  const [reminderSaved, setReminderSaved] = useState(false);

  // Opt-out generator
  const [picked, setPicked] = useState<SenderType[]>([]);
  const [channel, setChannel] = useState<OptOutChannel>("sms");
  const [optOuts, setOptOuts] = useState<{ sender: SenderType; text: string }[]>([]);
  const [optOutError, setOptOutError] = useState(false);
  const [copiedSender, setCopiedSender] = useState<SenderType | null>(null);

  // Spam log
  const [log, setLog] = useState(loadSpamLog);
  const [logKind, setLogKind] = useState<SpamKind>("sms");
  const [logSender, setLogSender] = useState("");
  const [logNote, setLogNote] = useState("");
  const [logCopied, setLogCopied] = useState(false);
  const [exportFailed, setExportFailed] = useState(false);

  // Visitors outside Hong Kong get a short note with an override (the page itself still works).
  const [hkState, setHkState] = useState<"loading" | "hk" | "other">("loading");
  useEffect(() => {
    let alive = true;
    isHongKongVisitor().then((hk) => alive && setHkState(hk ? "hk" : "other"));
    return () => {
      alive = false;
    };
  }, []);

  // GA4: hk_spam_view fires once per page load.
  useEffect(() => {
    track("hk_spam_view", { language: lang, platform, preview });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const steps = [
    copy.steps.tap,
    copy.steps.dial,
    view.keysHidden ? copy.steps.keysHidden : view.autoKeys ? copy.steps.keysAuto : copy.steps.keysManual,
    copy.steps.finish,
  ];

  const switchLang = () => {
    const next: PageLang = lang === "en" ? "zh" : "en";
    track("hk_spam_lang_switch", { from: lang, to: next });
    storeLang(next);
    setLang(next);
  };

  const onDone = async () => {
    if (status === "saving") return;
    const trimmed = email.trim();
    if (trimmed && !EMAIL_RE.test(trimmed)) {
      setFormError(copy.emailInvalid);
      return;
    }
    if (trimmed && !consent) {
      setFormError(copy.consentNeeded);
      return;
    }
    setFormError("");
    let row;
    try {
      row = buildRegistrationRow({ platform, lang, email: trimmed, reminderConsent: consent });
    } catch {
      setStatus("error"); // the holiday table only covers 2026-2027; never show a guessed date
      return;
    }
    setStatus("saving");
    setProtectionDate(row.protection_date);
    track("hk_spam_registered", { platform, language: lang, register: "all" });
    const ok = await insertRegistration(row);
    rememberRegistration(row.protection_date);
    setSaved(ok);
    if (ok && row.email) {
      setReminderSaved(true);
      track("hk_spam_email_submit", { platform, language: lang });
    }
    setStatus("done");
  };

  const toggleSender = (s: SenderType) =>
    setPicked((cur) => (cur.includes(s) ? cur.filter((x) => x !== s) : [...cur, s]));

  const onGenerate = () => {
    if (picked.length === 0) {
      setOptOutError(true);
      return;
    }
    setOptOutError(false);
    setOptOuts(SENDER_TYPES.filter((s) => picked.includes(s)).map((sender) => ({ sender, text: buildOptOutText({ sender, channel, lang }) })));
    setCopiedSender(null);
    track("hk_spam_optout_generated", { channel, language: lang, sender_types: picked.length });
  };

  const onExport = () => {
    setExportFailed(!downloadSpamLog(log, lang));
  };

  const didntWorkHref = `/contact?${new URLSearchParams({ source: "hk-spam", platform, lang }).toString()}`;

  const onAddLog = () => {
    const next = addSpamLogEntry(log, { kind: logKind, sender: logSender, note: logNote });
    if (next === log) return;
    setLog(next);
    setLogSender("");
    setLogNote("");
    track("hk_spam_log_added", { kind: logKind, language: lang });
  };

  const utm = getUtm();
  const scanQuery = new URLSearchParams(Object.keys(utm).length ? utm : { utm_source: "hongkongspam" }).toString();
  const meta = HK_SPAM_META[lang];
  const url = `${SITE_URL}${HK_SPAM_PATH}`;

  return (
    <div className="min-h-screen bg-background text-foreground" lang={copy.htmlLang}>
      <Seo title={meta.title} description={meta.description} path={HK_SPAM_PATH} noindex={!HK_SPAM_INDEXABLE} />
      <Helmet>
        <html lang={copy.htmlLang} />
        <link rel="alternate" hrefLang="en-HK" href={url} />
        <link rel="alternate" hrefLang="zh-HK" href={`${url}?lang=zh`} />
        <link rel="alternate" hrefLang="x-default" href={url} />
        {buildJsonLd(copy, steps).map((block) => (
          <script key={block["@type"]} type="application/ld+json">
            {JSON.stringify(block)}
          </script>
        ))}
      </Helmet>

      <div className="mx-auto max-w-xl px-4 pb-16 pt-6">
        <div className="mb-4 flex justify-end">
          <button
            type="button"
            onClick={switchLang}
            aria-label={copy.toggleAria}
            className="min-h-11 rounded-full border border-border px-4 text-sm font-semibold text-foreground hover:border-primary/60"
          >
            {copy.toggleLabel}
          </button>
        </div>

        {hkState === "other" && (
          <p role="note" className="mb-4 rounded-lg bg-muted p-3 text-center text-sm" data-testid="hk-nonhk-note">
            {copy.card.nonHkNote}{" "}
            <button
              type="button"
              className="min-h-11 px-1 font-semibold underline"
              onClick={() => {
                setHongKongOverride(true);
                setHkState("hk");
              }}
            >
              {copy.card.nonHkButton}
            </button>
          </p>
        )}
        {hkState === "hk" && hasHongKongOverride() && (
          <p className="mb-4 text-center text-xs text-muted-foreground">
            <button
              type="button"
              className="min-h-11 px-1 underline"
              onClick={() => {
                setHongKongOverride(false);
                setHkState("other");
              }}
            >
              {copy.card.notHkButton}
            </button>
          </p>
        )}

        {/* Hero */}
        <section className="text-center" aria-labelledby="hk-hero">
          <div className="mb-4 inline-block rounded-full border border-primary/30 bg-primary/10 px-4 py-1.5 text-xs font-semibold uppercase tracking-widest">
            {copy.badge}
          </div>
          <h1 id="hk-hero" className="mb-3 text-3xl font-bold leading-tight sm:text-4xl [text-wrap:balance]">
            {copy.heroTitle}
          </h1>
          <p className="mb-6 text-base text-muted-foreground">{copy.heroSub}</p>

          {view.keysUnverified && (
            <p role="note" className="mb-4 rounded-lg border-l-4 border-destructive bg-muted p-3 text-left text-sm" data-testid="hk-unverified">
              {copy.previewBanner}
            </p>
          )}

          <a
            href={view.dial}
            onClick={() =>
              track("hk_spam_dial_tap", { platform, language: lang, register: "all", keys_shown: !view.keysHidden })
            }
            className="block w-full rounded-2xl bg-primary px-4 py-5 text-center text-xl font-bold text-primary-foreground hover:bg-primary-hover"
            data-testid="hk-dial"
          >
            {copy.cta}
          </a>
          <p className="mt-2 text-sm text-muted-foreground">{copy.ctaSub}</p>
          {view.needsPhone && (
            <p role="note" className="mt-3 rounded-lg bg-muted p-3 text-sm">
              {copy.needsPhone}
            </p>
          )}
        </section>

        {/* Steps */}
        <section className="mt-8" aria-labelledby="hk-steps">
          <h2 id="hk-steps" className="mb-3 text-xl font-bold">
            {copy.stepsTitle}
          </h2>
          <ol className="space-y-3">
            {steps.map((s, i) => (
              <li key={s.title} className="flex gap-3 rounded-xl border border-border bg-card p-4">
                <span
                  aria-hidden="true"
                  className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary text-lg font-bold text-primary-foreground"
                >
                  {i + 1}
                </span>
                <div className="min-w-0">
                  <h3 className="font-semibold">{s.title}</h3>
                  <p className="text-sm text-muted-foreground">{s.body}</p>
                  {i === 2 && !view.keysHidden && (
                    <ul className="mt-3 flex flex-wrap gap-3" aria-label={copy.keysFallback} data-testid="hk-keys">
                      {view.keys.map((k, n) => (
                        <li
                          key={`${k.purpose}-${n}`}
                          className={`rounded-lg border border-border bg-background px-3 py-2 text-center ${view.autoKeys ? "" : "min-w-[5.5rem]"}`}
                        >
                          <span className="block text-xs text-muted-foreground">
                            {copy.press} ({copy.keyPurpose[k.purpose]})
                          </span>
                          <span className={`block font-mono font-bold ${view.autoKeys ? "text-2xl" : "text-5xl"}`}>{k.key}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </li>
            ))}
          </ol>
        </section>

        {/* Done + optional reminder */}
        <section className="mt-8 rounded-2xl border border-border bg-card p-4" aria-labelledby="hk-done">
          <h2 id="hk-done" className="mb-3 text-xl font-bold">
            {copy.doneTitle}
          </h2>
          {status !== "done" && (
            <>
              <label htmlFor="hk-email" className="mb-1 block text-sm font-medium">
                {copy.emailLabel}
              </label>
              <Input
                id="hk-email"
                type="email"
                inputMode="email"
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="h-12 text-base"
              />
              <p className="mb-3 mt-1 text-xs text-muted-foreground">{copy.emailHint}</p>
              {email.trim() && (
                <label htmlFor="hk-consent" className="mb-3 flex items-start gap-2 text-sm">
                  <input
                    id="hk-consent"
                    type="checkbox"
                    checked={consent}
                    onChange={(e) => setConsent(e.target.checked)}
                    className="mt-1 h-4 w-4 shrink-0"
                  />
                  <span>
                    {copy.consentLabel}
                    {!CONSENT_WORDING_FINAL && (
                      <strong className="mt-1 block text-xs text-destructive" data-testid="hk-consent-placeholder">
                        [{copy.consentPlaceholderTag}]
                      </strong>
                    )}
                  </span>
                </label>
              )}
              {formError && (
                <p role="alert" className="mb-3 border-l-4 border-destructive pl-3 text-sm">
                  {formError}
                </p>
              )}
              <Button type="button" onClick={onDone} disabled={status === "saving"} className="h-12 w-full text-base font-bold">
                {status === "saving" ? copy.saving : copy.doneButton}
              </Button>
            </>
          )}
          <div aria-live="polite">
            {status === "error" && (
              <p role="alert" className="mt-3 border-l-4 border-destructive pl-3 text-sm">
                {copy.resultError}
              </p>
            )}
            {status === "done" && protectionDate && (
              <div className="rounded-xl bg-primary/10 p-4" data-testid="hk-result">
                <h3 className="mb-1 text-lg font-bold">{copy.resultTitle.replace("{date}", formatHkDate(protectionDate, lang))}</h3>
                <p className="mb-2 text-base">{copy.resultBody}</p>
                <p className="text-sm text-muted-foreground">{copy.resultWeather}</p>
                {saved === false && <p className="mt-2 text-sm">{copy.resultSaveFailed}</p>}
                {reminderSaved && <p className="mt-2 text-sm">{copy.resultReminderSaved}</p>}
                <p className="mt-3 text-sm">
                  <Link to={didntWorkHref} className="inline-block min-h-11 py-2 font-semibold underline" data-testid="hk-didnt-work">
                    {copy.didntWork}
                  </Link>{" "}
                  <span className="text-muted-foreground">{copy.didntWorkBody}</span>
                </p>
              </div>
            )}
          </div>
        </section>

        {/* Secondary CTA: free privacy scan */}
        <section className="mt-8 rounded-2xl border border-surface-border bg-brand-soft p-5 text-center" aria-labelledby="hk-scan">
          <h2 id="hk-scan" className="mb-2 text-xl font-bold">
            {copy.scanTitle}
          </h2>
          <p className="mb-4 text-sm text-muted-foreground">{copy.scanBody}</p>
          <Button asChild variant="outline" className="h-12 text-base">
            <Link to={`/scan?${scanQuery}`} onClick={() => track("hk_spam_scan_click", { language: lang })}>
              {copy.scanButton}
            </Link>
          </Button>
        </section>

        {/* Consent clean-up */}
        <section className="mt-8" aria-labelledby="hk-optout">
          <h2 id="hk-optout" className="mb-2 text-xl font-bold">
            {copy.optOutTitle}
          </h2>
          <p className="mb-3 text-sm text-muted-foreground">{copy.optOutIntro}</p>
          <fieldset className="mb-3">
            <legend className="mb-1 block text-sm font-medium">{copy.optOutPick}</legend>
            <div className="space-y-1">
              {SENDER_TYPES.map((t) => (
                <label key={t} htmlFor={`hk-sender-${t}`} className="flex min-h-11 items-center gap-3 text-base">
                  <input
                    id={`hk-sender-${t}`}
                    type="checkbox"
                    checked={picked.includes(t)}
                    onChange={() => toggleSender(t)}
                    className="h-5 w-5 shrink-0"
                  />
                  {copy.senderTypes[t]}
                </label>
              ))}
            </div>
          </fieldset>
          <label htmlFor="hk-channel" className="mb-1 block text-sm font-medium">
            {copy.optOutChannel}
          </label>
          <select
            id="hk-channel"
            value={channel}
            onChange={(e) => setChannel(e.target.value as OptOutChannel)}
            className={`${SELECT_CLASS} mb-3`}
          >
            <option value="sms">{copy.channels.sms}</option>
            <option value="email">{copy.channels.email}</option>
            <option value="letter">{copy.channels.letter}</option>
          </select>
          {optOutError && (
            <p role="alert" className="mb-3 border-l-4 border-destructive pl-3 text-sm">
              {copy.optOutNonePicked}
            </p>
          )}
          <Button type="button" onClick={onGenerate} className="h-12 w-full text-base font-bold">
            {copy.optOutGenerate}
          </Button>
          {optOuts.map(({ sender, text }) => (
            <div key={sender} className="mt-3" data-testid={`hk-optout-${sender}`}>
              <label htmlFor={`hk-optout-text-${sender}`} className="mb-1 block text-sm font-semibold">
                {copy.optOutFor} {copy.senderTypes[sender]}
              </label>
              <textarea
                id={`hk-optout-text-${sender}`}
                readOnly
                value={text}
                rows={6}
                className="w-full rounded-md border border-input bg-background p-3 text-sm"
              />
              <Button
                type="button"
                variant="outline"
                className="mt-2 h-11"
                onClick={async () => setCopiedSender((await copyText(text)) ? sender : null)}
              >
                {copiedSender === sender ? copy.optOutCopied : copy.optOutCopy}
              </Button>
            </div>
          ))}
        </section>

        {/* On-device spam log */}
        <section className="mt-8" aria-labelledby="hk-log">
          <h2 id="hk-log" className="mb-2 text-xl font-bold">
            {copy.logTitle}
          </h2>
          <p className="mb-1 text-sm text-muted-foreground">{copy.logIntro}</p>
          <p className="mb-3 text-xs text-muted-foreground">{copy.logPrivacy}</p>
          <label htmlFor="hk-log-kind" className="mb-1 block text-sm font-medium">
            {copy.logKind}
          </label>
          <select
            id="hk-log-kind"
            value={logKind}
            onChange={(e) => setLogKind(e.target.value as SpamKind)}
            className={`${SELECT_CLASS} mb-3`}
          >
            {SPAM_KINDS.map((k) => (
              <option key={k} value={k}>
                {copy.logKinds[k]}
              </option>
            ))}
          </select>
          <label htmlFor="hk-log-sender" className="mb-1 block text-sm font-medium">
            {copy.logSender}
          </label>
          <Input
            id="hk-log-sender"
            value={logSender}
            onChange={(e) => setLogSender(e.target.value)}
            placeholder={copy.logSenderPlaceholder}
            maxLength={60}
            className="mb-3 h-12 text-base"
          />
          <label htmlFor="hk-log-note" className="mb-1 block text-sm font-medium">
            {copy.logNote}
          </label>
          <Input
            id="hk-log-note"
            value={logNote}
            onChange={(e) => setLogNote(e.target.value)}
            maxLength={200}
            className="mb-3 h-12 text-base"
          />
          <Button type="button" onClick={onAddLog} disabled={!logSender.trim()} className="h-12 w-full text-base font-bold">
            {copy.logAdd}
          </Button>
          {log.length === 0 ? (
            <p className="mt-3 text-sm text-muted-foreground">{copy.logEmpty}</p>
          ) : (
            <>
              <ul className="mt-3 space-y-2" data-testid="hk-log-list">
                {log.map((e) => (
                  <li key={e.id} className="flex items-start justify-between gap-2 rounded-lg border border-border p-3 text-sm">
                    <span className="min-w-0 break-words">
                      <span className="font-semibold">{spamKindLabel(e.kind, lang)}</span> · {e.sender}
                      {e.note ? ` · ${e.note}` : ""}
                      <span className="block text-xs text-muted-foreground">
                        {new Intl.DateTimeFormat(lang === "zh" ? "zh-HK" : "en-HK", {
                          dateStyle: "medium",
                          timeStyle: "short",
                          timeZone: "Asia/Hong_Kong",
                        }).format(new Date(e.at))}
                      </span>
                    </span>
                    <button
                      type="button"
                      className="shrink-0 text-xs underline"
                      onClick={() => setLog(removeSpamLogEntry(log, e.id))}
                    >
                      {copy.logRemove}
                    </button>
                  </li>
                ))}
              </ul>
              <div className="mt-3 flex flex-wrap gap-2">
                <Button
                  type="button"
                  variant="outline"
                  className="h-11"
                  onClick={async () => setLogCopied(await copyText(spamLogToText(log, lang)))}
                >
                  {logCopied ? copy.optOutCopied : copy.logCopyAll}
                </Button>
                <Button type="button" variant="outline" className="h-11" onClick={onExport} data-testid="hk-log-export">
                  {copy.logExport}
                </Button>
                <Button type="button" variant="outline" className="h-11" onClick={() => setLog(clearSpamLog())}>
                  {copy.logClear}
                </Button>
              </div>
              {exportFailed && (
                <p role="alert" className="mt-2 text-sm">
                  {copy.logExportFailed}
                </p>
              )}
            </>
          )}
        </section>

        {/* FAQ */}
        <section className="mt-8" aria-labelledby="hk-faq">
          <h2 id="hk-faq" className="mb-3 text-xl font-bold">
            {copy.faqTitle}
          </h2>
          <div className="space-y-2">
            {copy.faqs.map(({ q, a }) => (
              <details key={q} className="rounded-lg border border-border bg-card p-4">
                <summary className="cursor-pointer font-semibold">{q}</summary>
                <p className="mt-2 text-sm text-muted-foreground">{a}</p>
              </details>
            ))}
          </div>
        </section>

        {/* Not-OFCA disclaimer */}
        <p className="mt-8 text-xs text-muted-foreground" data-testid="hk-disclaimer">
          {copy.disclaimer}{" "}
          <a href="https://www.dnc.gov.hk" target="_blank" rel="noopener noreferrer" className="underline">
            {copy.disclaimerLink}
          </a>
          .
        </p>
      </div>
    </div>
  );
};

/** Route wrapper: lowercase, trailing-slash and other case variants all land on the canonical /HongKongSpam. */
const HongKongSpam = () => {
  const { pathname, search, hash } = useLocation();
  if (!HK_SPAM_ENABLED) return <Navigate to="/" replace />; // kill switch (hkDnc.ts)
  if (pathname !== HK_SPAM_PATH) return <Navigate to={`${HK_SPAM_PATH}${search}${hash}`} replace />;
  return <HongKongSpamPage />;
};

export default HongKongSpam;
