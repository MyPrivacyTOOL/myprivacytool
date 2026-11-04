// Continuous monitoring dashboard for Pro and Executive plans (MPC-7649). Shows the schedule, alert settings, open
// exposures and the false-positive rate. Until user accounts and the monitoring Worker exist it renders sample data,
// is noindex, and is hidden in production (src/config/monitoring.ts).
import { useMemo, useState } from "react";
import { Navigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import Seo from "@/components/Seo";
import { monitoringVisible } from "@/config/monitoring";
import { SAMPLE_FINDINGS, SAMPLE_LAST_RUNS, SAMPLE_SUBSCRIPTION } from "@/data/monitoringSample";
import {
  KIND_LABEL,
  enabledKinds,
  markFinding,
  nextDue,
  sortFindings,
  summarise,
  type FindingStatus,
} from "@/lib/monitoring";

const SOURCE_LABEL = { breach_db: "Breach database", dark_web: "Dark web", social: "Social media" } as const;
const fmt = (d: Date | string) => new Date(d).toISOString().slice(0, 10);

const Monitoring = () => {
  const [findings, setFindings] = useState(SAMPLE_FINDINGS);
  const stats = useMemo(() => summarise(findings), [findings]);
  const sub = SAMPLE_SUBSCRIPTION;

  if (!monitoringVisible()) return <Navigate to="/pricing" replace />;

  const set = (id: string, status: FindingStatus) => setFindings((f) => markFinding(f, id, status));

  return (
    <>
      <Seo title="Monitoring | MyPrivacyTOOL" description="Continuous monitoring for Pro plans." path="/monitoring" noindex />
      <main className="min-h-screen bg-background">
        <div className="mx-auto max-w-4xl px-4 py-16 sm:px-6 lg:px-8">
          <h1 className="mb-2 text-4xl font-bold text-foreground">Monitoring</h1>
          <p role="note" className="mb-8 rounded-md bg-muted p-3 text-sm text-muted-foreground">
            Preview with sample data. Live checks are not switched on yet.
          </p>

          <section aria-labelledby="mon-summary" className="mb-8 grid gap-4 sm:grid-cols-3">
            <h2 id="mon-summary" className="sr-only">Summary</h2>
            <div className="rounded-lg border border-border p-4">
              <p className="text-3xl font-bold text-foreground">{stats.open}</p>
              <p className="text-sm text-muted-foreground">open exposures ({stats.highOpen} high)</p>
            </div>
            <div className="rounded-lg border border-border p-4">
              <p className="text-3xl font-bold text-foreground">{stats.falsePositivePct}%</p>
              <p className="text-sm text-muted-foreground">
                marked not mine {stats.meetsFalsePositiveTarget ? "(within the 1% target)" : "(above the 1% target)"}
              </p>
            </div>
            <div className="rounded-lg border border-border p-4">
              <p className="text-3xl font-bold text-foreground">{stats.total}</p>
              <p className="text-sm text-muted-foreground">exposures found in total</p>
            </div>
          </section>

          <section aria-labelledby="mon-schedule" className="mb-8">
            <h2 id="mon-schedule" className="mb-3 text-xl font-semibold text-foreground">Checks</h2>
            <ul className="space-y-2 text-sm text-muted-foreground">
              {enabledKinds(sub).map((k) => (
                <li key={k} className="flex justify-between rounded-md border border-border p-3">
                  <span className="text-foreground">{KIND_LABEL[k]}</span>
                  <span>last {fmt(SAMPLE_LAST_RUNS[k])}, next {fmt(nextDue(k, SAMPLE_LAST_RUNS[k]))}</span>
                </li>
              ))}
            </ul>
            <p className="mt-3 text-sm text-muted-foreground">
              Alerts go to {sub.email}. Text alerts for high severity need your phone number and your opt-in; neither is on file.
            </p>
          </section>

          <section aria-labelledby="mon-findings">
            <h2 id="mon-findings" className="mb-3 text-xl font-semibold text-foreground">Exposures</h2>
            <ul className="space-y-3">
              {sortFindings(findings).map((f) => (
                <li key={f.id} className="rounded-lg border border-border p-4">
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <p className="font-medium text-foreground">{f.label}</p>
                    <p className="text-xs text-muted-foreground">
                      {SOURCE_LABEL[f.source]} · {fmt(f.foundAt)} · {f.severity} · {f.status.replace("_", " ")}
                    </p>
                  </div>
                  <p className="mt-1 text-sm text-muted-foreground">Exposed: {f.dataClasses.join(", ")}</p>
                  {(f.status === "new" || f.status === "seen") && (
                    <div className="mt-3 flex gap-2">
                      <Button size="sm" variant="outline" onClick={() => set(f.id, "resolved")}>Mark resolved</Button>
                      <Button size="sm" variant="outline" onClick={() => set(f.id, "not_mine")}>Not mine</Button>
                    </div>
                  )}
                </li>
              ))}
            </ul>
          </section>
        </div>
      </main>
    </>
  );
};

export default Monitoring;
