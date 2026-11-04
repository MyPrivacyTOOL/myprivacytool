import { useState } from 'react';
import type { Finding } from '@/lib/strangerGuess';

type Verdict = 'right' | 'wrong' | 'unsure';

const BAND_LABEL: Record<Finding['band'], string> = {
  likely: 'Likely',
  possible: 'Possible',
  'long-shot': 'Long shot',
};

// CK-7805: verdicts live in this component's state only. Nothing is stored, sent or tracked.
export default function StrangerGuessCard({ findings }: { findings: Finding[] }) {
  const [openId, setOpenId] = useState<string | null>(null);
  const [verdicts, setVerdicts] = useState<Record<string, Verdict>>({});
  if (findings.length === 0) return null;

  return (
    <section
      className="w-full max-w-xl mx-auto my-6 rounded-2xl border border-surface-border bg-surface shadow-card p-4 sm:p-6"
      aria-labelledby="stranger-guess-title"
      data-testid="stranger-guess-card"
    >
      <h2 id="stranger-guess-title" className="text-lg font-semibold text-foreground">
        What a stranger could guess about you
      </h2>
      <p className="text-sm text-muted-foreground mt-1">Guesses, not facts. Tap one to see why.</p>
      <ul className="mt-4 space-y-3">
        {findings.map((f) => {
          const open = openId === f.id;
          return (
            <li key={f.id} className="rounded-xl border border-surface-border">
              <button
                type="button"
                className="w-full text-left p-3 sm:p-4 flex items-start justify-between gap-3 min-h-[44px]"
                aria-expanded={open}
                onClick={() => setOpenId(open ? null : f.id)}
              >
                <span className="text-base text-foreground">{f.claim}</span>
                <span className="shrink-0 text-xs rounded-full border border-surface-border px-2 py-1 text-muted-foreground">
                  {BAND_LABEL[f.band]}
                </span>
              </button>
              {open && (
                <div className="px-3 pb-3 sm:px-4 sm:pb-4 text-sm text-foreground space-y-2">
                  <p><span className="font-medium">Because:</span> {f.evidence.join(' ')}</p>
                  <p><span className="font-medium">What you can do:</span> {f.action}</p>
                  <div className="flex flex-wrap items-center gap-2 pt-1" role="group" aria-label="Was this right?">
                    <span className="text-muted-foreground">Was this right?</span>
                    {(['right', 'wrong', 'unsure'] as Verdict[]).map((v) => (
                      <button
                        key={v}
                        type="button"
                        aria-pressed={verdicts[f.id] === v}
                        className={`rounded-full border px-3 py-2 min-h-[44px] text-sm ${verdicts[f.id] === v ? 'border-brand-ink bg-brand-soft' : 'border-surface-border'}`}
                        onClick={() => setVerdicts((prev) => ({ ...prev, [f.id]: v }))}
                      >
                        {v === 'right' ? 'Right' : v === 'wrong' ? 'Wrong' : 'Not sure'}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
