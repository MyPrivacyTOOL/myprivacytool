import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import Seo from "@/components/Seo";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

// MPC-7893: the private dashboard for a Telegram scan. Reached only through the one-time link (/d/<uuid>), which sets an HttpOnly session cookie and
// redirects here with no token in the address. Everything shown comes from /api/dashboard; nothing is invented here, and opening this page never runs a
// scan, a DEEP check, a message or a signup. No analytics events are sent from this page.

interface Hex { id: string; label: string; arrival_label: string; state: string; value?: string | null; value_note?: string | null; explain?: string | null }
interface Risk { returned: number; possible: number; notChecked: number; percent: number; label: string }
interface DeepResult { source: string; site_name: string; status: string; observed_at: string; limitation: string }
interface Change { id: string; label: string; before: string; after: string; kind: string }
/* eslint-disable @typescript-eslint/no-explicit-any */
interface Data { generated_at: string; baseline: any; enhanced: any; final: any; cta: { href: string; label: string }; deep_reminder: string }

const STATE_LABEL: Record<string, string> = {
  returned: "Received by the bot", not_returned: "Not returned: good", not_checked: "Not checked", check_failed: "Check failed", user_provided: "Provided by you", missing: "Missing",
};
const DEEP_STATUS: Record<string, string> = { found: "Username found", not_found: "Not found (not an all-clear)", unavailable: "Site unavailable", blocked: "Blocked by the site", error: "Check failed" };
const when = (iso?: string | null): string => (iso ? new Date(iso).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" }) : "");

const Cta = ({ cta }: { cta: Data["cta"] }) => (
  <div className="mt-6 rounded-lg border p-4">
    <p className="text-sm text-muted-foreground">The Telegram bot sees only a small part of what is known about you. The website scan checks the rest.</p>
    <Link to={cta.href} className="mt-3 inline-block rounded-md bg-primary px-4 py-2 text-primary-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2">
      {cta.label}
    </Link>
  </div>
);

const Limits = ({ items }: { items?: string[] }) =>
  items?.length ? (
    <ul className="mt-4 list-disc space-y-1 pl-5 text-sm text-muted-foreground">
      {items.map((l) => <li key={l}>{l}</li>)}
    </ul>
  ) : null;

const Unavailable = ({ text }: { text: string }) => (
  <p role="status" className="rounded-md border border-dashed p-4 text-sm text-muted-foreground">{text}</p>
);

function Baseline({ b }: { b: any }) {
  if (b.state !== "available") return <Unavailable text={b.reason} />;
  const risk: Risk = b.risk;
  return (
    <div>
      <p className="text-2xl font-bold">{risk.returned} of {risk.possible} <span className="text-base font-normal text-muted-foreground">fields received by the bot ({risk.percent}%, {risk.label})</span></p>
      <p className="mt-1 text-sm text-muted-foreground">{risk.notChecked} {risk.notChecked === 1 ? "field was" : "fields were"} not checked in this scan. Scan taken {when(b.taken_at)}. Versions: scan {b.scan_version}, risk {b.risk_version}, schema {b.schema_version}.</p>
      <p className="mt-4 text-sm">Here is what Telegram handed to the bot, shown as it was received. Only you can see this page.</p>
      <ul className="mt-2 grid gap-2 sm:grid-cols-2">
        {(b.hexagons as Hex[]).map((h) => (
          <li key={h.id} className="flex items-start justify-between gap-3 rounded-md border px-3 py-2 text-sm">
            <span className="min-w-0">
              {h.label}<span className="block text-xs text-muted-foreground">{h.arrival_label}</span>
              {h.value ? <span className="mt-1 block break-words font-medium" data-testid={`value-${h.id}`}>{h.value}</span> : null}
              {h.value_note ? <span className="mt-1 block text-xs text-muted-foreground">{h.value_note}</span> : null}
              {h.explain ? <span className="mt-1 block text-xs text-muted-foreground" data-testid={`explain-${h.id}`}>{h.explain}</span> : null}
            </span>
            <Badge className={`shrink-0 ${h.state === "not_returned" ? "bg-emerald-700 text-white hover:bg-emerald-700" : ""}`} variant={h.state === "returned" ? "destructive" : "secondary"}>{STATE_LABEL[h.state] ?? h.state}</Badge>
          </li>
        ))}
      </ul>
      {b.never_sent?.length > 0 && (
        <p className="mt-4 text-sm">✅ Never sent to bots by Telegram: {b.never_sent.join(", ")}. This is how Telegram's bot system works, not a check of your settings.</p>
      )}
      {b.insights?.length > 0 && (
        <div className="mt-4"><h3 className="font-semibold">What this shows</h3><ul className="list-disc pl-5 text-sm">{b.insights.map((i: string) => <li key={i}>{i}</li>)}</ul></div>
      )}
      <Limits items={b.limits} />
    </div>
  );
}

function Enhanced({ e, reminder }: { e: any; reminder: string }) {
  return (
    <div>
      <p role="status" className="text-sm">{e.note}</p>
      {e.state === "not_run" || e.state === "unavailable" ? <p className="mt-3 text-sm text-muted-foreground">{reminder}</p> : null}
      {e.started_at && <p className="mt-2 text-xs text-muted-foreground">Started {when(e.started_at)}{e.finished_at ? `, finished ${when(e.finished_at)}` : ""}. Detector {e.detector_version}.</p>}
      {e.results_unavailable && <Unavailable text="The individual results could not be loaded just now." />}
      {Array.isArray(e.results) && e.results.length > 0 && (
        <ul className="mt-4 space-y-2">
          {(e.results as DeepResult[]).map((r) => (
            <li key={r.source} className="rounded-md border px-3 py-2 text-sm">
              <div className="flex items-center justify-between gap-2"><span className="font-medium">{r.site_name}</span><Badge variant={r.status === "found" ? "destructive" : "secondary"}>{DEEP_STATUS[r.status] ?? r.status}</Badge></div>
              <p className="text-xs text-muted-foreground">Observed {when(r.observed_at)}. {r.limitation}</p>
            </li>
          ))}
        </ul>
      )}
      <Limits items={e.limits} />
    </div>
  );
}

function Final({ f }: { f: any }) {
  if (f.state === "unavailable" || f.state === "not_run") return <Unavailable text={f.note} />;
  return (
    <div>
      <p className="text-sm text-muted-foreground">Baseline {when(f.baseline_at)}. Re-check {when(f.recheck_at)}.</p>
      {f.state === "incomparable" ? (
        <div role="status" className="mt-3 rounded-md border p-4 text-sm"><p>{f.note}</p><ul className="mt-2 list-disc pl-5">{f.reasons.map((r: string) => <li key={r}>{r}</li>)}</ul></div>
      ) : (
        <>
          <p className="mt-3 text-2xl font-bold">{f.risk_before.returned} → {f.risk_after.returned} <span className="text-base font-normal text-muted-foreground">of {f.risk_after.possible} fields received by the bot</span></p>
          <p className="mt-1 text-sm">No longer returned: {f.summary.no_longer_returned}. Newly returned: {f.summary.newly_returned}. Unchanged: {f.summary.unchanged}. Inconclusive (not checked or failed in one scan): {f.summary.inconclusive}.</p>
          {f.changes.length > 0 && (
            <ul className="mt-3 space-y-1 text-sm">{(f.changes as Change[]).map((c) => <li key={c.id}>{c.label}: {STATE_LABEL[c.before] ?? c.before} → {STATE_LABEL[c.after] ?? c.after}</li>)}</ul>
          )}
          <p className="mt-3 text-sm text-muted-foreground">{f.note}</p>
        </>
      )}
      <p className="mt-3 text-sm text-muted-foreground">{f.state === "comparable" ? "Observed changes come from comparing the two scans. " : ""}{f.self_reported.note}</p>
    </div>
  );
}

const MESSAGES: Record<number, string> = {
  401: "This page needs a fresh link. Links work once and expire after 15 minutes. Go back to Telegram and ask the bot for a new one.",
  410: "This scan is no longer stored, so there is nothing to show. Go back to Telegram to scan again.",
  503: "The dashboard is not available right now. Please try again later.",
};

const TelegramDashboard = () => {
  const [data, setData] = useState<Data | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    const ctl = new AbortController();
    fetch("/api/dashboard", { credentials: "same-origin", cache: "no-store", signal: ctl.signal })
      .then(async (r) => (r.ok ? setData(await r.json()) : setError(MESSAGES[r.status] ?? "Something went wrong. Please try again later.")))
      .catch((e) => { if (e?.name !== "AbortError") setError("Something went wrong. Please try again later."); });
    return () => ctl.abort();
  }, []);

  return (
    <main className="mx-auto max-w-3xl px-4 py-10">
      <Seo title="Your Telegram privacy dashboard | MyPrivacyTOOL" description="Your private Telegram scan dashboard." path="/dashboard" noindex />
      <h1 className="text-2xl font-bold">Your Telegram privacy dashboard</h1>
      <details className="mt-2 text-sm">
        <summary className="cursor-pointer underline">Help</summary>
        <p className="mt-2 text-muted-foreground">This page shows what the Telegram bot found in your scan. Opening it does not scan anything, run DEEP, send a message or sign you up. To change what the bot can see, use Telegram, Settings, Privacy. In Telegram you can type HELP at any time.</p>
      </details>
      {error ? (
        <Unavailable text={error} />
      ) : !data ? (
        <p role="status" className="mt-6 text-muted-foreground">Loading your dashboard…</p>
      ) : (
        <Tabs defaultValue="baseline" className="mt-6">
          <TabsList aria-label="Dashboard views">
            <TabsTrigger value="baseline">Baseline</TabsTrigger>
            <TabsTrigger value="enhanced">Enhanced</TabsTrigger>
            <TabsTrigger value="final">Final</TabsTrigger>
          </TabsList>
          <TabsContent value="baseline"><Card><CardHeader><CardTitle>Baseline: what the bot received</CardTitle></CardHeader><CardContent><Baseline b={data.baseline} /><Cta cta={data.cta} /></CardContent></Card></TabsContent>
          <TabsContent value="enhanced"><Card><CardHeader><CardTitle>Enhanced: DEEP results</CardTitle></CardHeader><CardContent><Enhanced e={data.enhanced} reminder={data.deep_reminder} /><Cta cta={data.cta} /></CardContent></Card></TabsContent>
          <TabsContent value="final"><Card><CardHeader><CardTitle>Final: after your re-check</CardTitle></CardHeader><CardContent><Final f={data.final} /><Cta cta={data.cta} /></CardContent></Card></TabsContent>
        </Tabs>
      )}
    </main>
  );
};

export default TelegramDashboard;
