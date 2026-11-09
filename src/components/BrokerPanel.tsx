import { Link } from "react-router-dom";
import type { BrokerPanel as Panel, BrokerRow } from "@/lib/liveScan";

// MPC-9814: the broker section of a result. Every scan shows all nine shortlist brokers; a site is "listed" or "not listed" only when the visitor
// pasted a page and we read it. The words come from the Worker (workers/scan-report/lib/brokerPanel.js), the same words the report email uses.
// Styles are the result list's own (rounded border card, muted second line); state is carried by words, never by colour alone.
const STATE_WORD = { listed: "Listed", not_listed: "Not listed", not_checked: "Not checked" } as const;

function Confidence({ row }: { row: BrokerRow }) {
  if (!row.confidenceWord) return <span className="text-xs text-muted-foreground">Confidence: none, nothing was checked</span>;
  return (
    <span className="flex items-center gap-2 text-xs text-muted-foreground" data-testid="confidence">
      Confidence: <strong className="font-semibold text-foreground">{row.confidenceWord}</strong>
      <span aria-hidden="true" className="inline-flex gap-0.5">
        {[1, 2, 3].map((n) => <span key={n} className={`h-1.5 w-4 rounded-sm ${n <= row.confidenceLevel ? "bg-foreground" : "bg-border"}`} />)}
      </span>
    </span>
  );
}

function Row({ row }: { row: BrokerRow }) {
  const guess = row.state === "listed" && row.is_guess;
  return (
    <li className={`rounded-md border bg-background px-3 py-2 text-sm ${guess ? "border-dashed border-foreground/60" : "border-border"}`} data-state={row.state} data-broker={row.key} data-guess={guess ? "true" : undefined}>
      <span className="flex flex-wrap items-baseline justify-between gap-x-3">
        <span className="font-medium text-foreground">{row.name}{row.region && <span className="ml-2 text-xs font-normal text-muted-foreground">{row.region}</span>}</span>
        <span className={row.state === "not_checked" ? "text-xs text-muted-foreground" : "text-xs font-semibold text-foreground"}>{STATE_WORD[row.state]}{guess ? " (a guess)" : ""}</span>
      </span>
      <span className={`mt-1 block ${guess ? "italic text-foreground" : "text-muted-foreground"}`}>{row.text}</span>
      <span className="mt-1 block"><Confidence row={row} /></span>
      <span className="mt-1 flex flex-wrap gap-x-3 text-xs">
        {row.evidenceUrl && <a href={row.evidenceUrl} target="_blank" rel="noopener noreferrer" className="underline">Evidence: the page</a>}
        {row.also.filter((a) => a.evidenceUrl).map((a, i) => <a key={i} href={a.evidenceUrl!} target="_blank" rel="noopener noreferrer" className="underline">Also read ({a.state.replace("_", " ")})</a>)}
        {row.guide
          ? <Link to={`/opt-out-guides/${row.guide.slug}`} className="underline">How to remove it{row.guide.timeNeeded ? ` (${row.guide.timeNeeded})` : ""}</Link>
          : <span className="text-muted-foreground">{row.noGuideText}</span>}
        {!row.guide && <Link to="/opt-out-guides" className="underline">General method and all guides</Link>}
      </span>
    </li>
  );
}

export default function BrokerPanel({ panel }: { panel: Panel }) {
  return (
    <section aria-labelledby="broker-panel-title" className="mt-5" data-testid="broker-panel">
      <h3 id="broker-panel-title" className="text-sm font-semibold text-foreground">Broker sites</h3>
      <p className="mt-1 text-xs text-muted-foreground">{panel.intro}</p>
      {panel.pending && <p className="mt-2 text-sm text-muted-foreground" role="status">Reading the pages you showed us. This takes a moment.</p>}
      <ul className="mt-2 space-y-2">
        {[...panel.rows, ...panel.others].map((r, i) => <Row key={`${r.key}-${i}`} row={r} />)}
      </ul>
      {panel.regionNote && <p className="mt-3 text-xs text-muted-foreground" data-testid="broker-region-note">{panel.regionNote}</p>}
      {panel.coverageNote && <p className="mt-1 text-xs text-muted-foreground">{panel.coverageNote}</p>}
      {panel.upgrade && <p className="mt-3 text-sm text-foreground" data-testid="broker-upgrade">{panel.upgrade}</p>}
    </section>
  );
}
