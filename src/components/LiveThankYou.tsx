import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { LIVE_COPY, STATUS_GLYPH, STATUS_WORDS, liveCounts, liveSummary, type LiveCell } from "@/lib/liveThankYou";

// MPC-8452 option A. Shown under the existing thank-you box. Replays the visitor's own finished scan: a hexagon is "waiting" (no colour, no word
// about the finding) until its turn, then shows the status decided at capture. Nothing is fetched, stored or sent from here.
const STEP_MS = 150;
const CURTAIN_MS = 1300;

const prefersReducedMotion = (): boolean => {
  try {
    return typeof window !== "undefined" && !!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
  } catch {
    return false;
  }
};

export default function LiveThankYou({ cells, imageSrc = "/footprint/alice-curtain.jpg?v=2" }: { cells: LiveCell[]; imageSrc?: string }) {
  const total = cells.length;
  const [reduced] = useState(prefersReducedMotion);
  // Reduced motion: the finished state at once. Otherwise count up after the curtain has opened.
  const [shown, setShown] = useState(reduced ? total : 0);

  useEffect(() => {
    if (reduced || total === 0) return;
    let timer: ReturnType<typeof setInterval> | undefined;
    const start = setTimeout(() => {
      timer = setInterval(() => {
        setShown((n) => {
          if (n + 1 >= total && timer) clearInterval(timer);
          return Math.min(total, n + 1);
        });
      }, STEP_MS);
    }, CURTAIN_MS);
    // A hidden tab jumps to the end state rather than animating unseen.
    const onVisibility = () => {
      if (document.hidden) setShown(total);
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      clearTimeout(start);
      if (timer) clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [reduced, total]);

  const done = total > 0 && shown >= total;
  const counts = useMemo(() => liveCounts(cells.slice(0, shown)), [cells, shown]);
  // One announcement at the start, one at the halfway point and one at the end. Never one per hexagon.
  const halfway = total > 0 && shown >= Math.ceil(total / 2);
  const announcement = done ? LIVE_COPY.done : halfway ? LIVE_COPY.halfway : LIVE_COPY.start;

  if (total === 0) {
    return (
      <section className="mx-auto mt-8 max-w-md rounded-xl border border-border p-6 text-center" data-testid="live-thank-you-no-scan" aria-label="Alice">
        <p className="text-sm text-foreground">{LIVE_COPY.noScan}</p>
        <Link to="/" className="mt-3 inline-block font-semibold text-brand underline">{LIVE_COPY.noScanLink}</Link>
      </section>
    );
  }

  return (
    <section className="mx-auto mt-8 max-w-2xl text-center" data-testid="live-thank-you" aria-label="Alice shows what she checked">
      <div className="relative mx-auto aspect-square w-full max-w-sm overflow-hidden rounded-xl bg-white" data-testid="live-thank-you-image">
        <img src={imageSrc} alt={LIVE_COPY.imageAlt} className="lty-fade h-full w-full object-contain" />
        <div className="lty-curtain absolute inset-0 bg-black" aria-hidden="true" />
      </div>

      <p className="mt-4 text-sm text-muted-foreground" aria-hidden="true">{LIVE_COPY.curtain}</p>
      <p className="mt-2 text-base text-foreground" role="status" aria-live="polite" data-testid="live-thank-you-alice">{announcement}</p>

      <ul className="mt-6 grid grid-cols-2 gap-2 sm:grid-cols-3" aria-label="What was checked">
        {cells.map((cell, i) => {
          const revealed = i < shown;
          return (
            <li
              key={cell.id}
              data-status={revealed ? cell.status : "waiting"}
              className={`flex min-h-[44px] items-center gap-2 rounded-lg border px-3 py-2 text-left text-sm ${revealed ? "border-border bg-card" : "border-dashed border-border bg-transparent text-muted-foreground"}`}
            >
              <span aria-hidden="true" className="w-4 text-center font-bold">{revealed ? STATUS_GLYPH[cell.status] : "·"}</span>
              <span className="flex-1">
                <span className="block font-medium">{cell.label}</span>
                <span className="block text-xs text-muted-foreground">{revealed ? STATUS_WORDS[cell.status] : LIVE_COPY.waiting}</span>
              </span>
            </li>
          );
        })}
      </ul>

      {done && (
        <p className="mt-6 text-sm text-foreground" data-testid="live-thank-you-summary">{liveSummary(counts)}</p>
      )}
    </section>
  );
}
