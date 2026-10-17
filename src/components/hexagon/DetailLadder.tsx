import { useState } from 'react';
import { getHexagon } from '../../../shared/hexagon-registry/registry.js';
import { captureStatus } from '../../../shared/hexagon-registry/status.js';
import type { HexagonData } from '@/lib/deviceDetection';
import type { HexagonTile, TileKind } from '@/lib/hexagonTile';

export type DetailLevel = 1 | 2 | 3 | 4;

const LEVELS: { level: DetailLevel; name: string }[] = [
  { level: 1, name: 'Risk profile' },
  { level: 2, name: 'Reasons' },
  { level: 3, name: 'Pro mode' },
  { level: 4, name: 'Expert mode' },
];

const REASON: Record<TileKind, string> = {
  clear: 'We checked and found nothing.',
  needs_fixing: 'A tracker can read this and it matters.',
  our_guess: 'Comes from your internet address or an estimate. It is our guess.',
  seen_low_risk: 'A tracker can read this, but it does little harm.',
  you_told_us: 'You said you fixed it. We have not checked again.',
  you_confirmed: 'You said our guess is right. That is your word, not our proof.',
  device_agrees: "Your device's own location agrees with our guess.",
  guess_wrong: 'We guessed, and the guess was wrong.',
  not_checked: 'We have not looked at this yet.',
  couldnt_check: 'The check was blocked or did not finish.',
  cant_check_here: 'A web page cannot check this.',
};

const SOURCE: Record<string, string> = {
  measured: 'Read from your browser',
  estimated: 'Our estimate',
  cannot_be_checked: 'Cannot be checked from a web page',
};

interface Row {
  hexagon: HexagonData;
  tile: HexagonTile;
}

// MPC-7916 Phase 2: the four levels. Level 1 is the counts line on the page. Levels 2 to 4 go deeper only when the visitor asks.
// Nothing here shows a percentage or a score.
export default function DetailLadder({ rows, level, onLevel }: { rows: Row[]; level: DetailLevel; onLevel: (l: DetailLevel) => void }) {
  const [open, setOpen] = useState<string | null>(null);
  return (
    <div className="max-w-xl mx-auto mb-6" data-testid="detail-ladder">
      <div role="group" aria-label="How much detail" className="flex flex-wrap justify-center gap-2 mb-3">
        {LEVELS.map((l) => (
          <button
            key={l.level}
            type="button"
            aria-pressed={level === l.level}
            onClick={() => onLevel(l.level)}
            className={`rounded-full border px-3 py-1 text-xs font-semibold focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 ${
              level === l.level ? 'bg-primary text-primary-foreground border-primary' : 'border-surface-border text-muted-foreground hover:bg-muted'
            }`}
          >
            {l.name}
          </button>
        ))}
      </div>
      {level > 1 && (
        <ul className="space-y-2" data-testid={`detail-level-${level}`}>
          {rows.map(({ hexagon, tile }) => {
            const reg = getHexagon(hexagon.id);
            const raw = hexagon.displayValue ?? hexagon.value;
            const isOpen = open === hexagon.id;
            return (
              <li key={hexagon.id} className="rounded-xl border border-surface-border bg-surface p-3 text-sm">
                <p className="font-semibold text-foreground">
                  <span aria-hidden="true">{tile.glyph}</span> {hexagon.label} <span className="font-normal text-muted-foreground">· {tile.line}</span>
                </p>
                <p className="text-muted-foreground">{REASON[tile.kind]}</p>
                {level >= 3 && (
                  <p className="text-muted-foreground mt-1" data-testid="pro-detail">
                    {tile.kind === 'you_told_us'
                      ? 'Your word, not our check'
                      : !tile.showValue
                        ? 'No reading used'
                        : SOURCE[reg?.truth.level ?? ''] ?? 'Source unknown'}{' '}
                    · Matters: {reg?.truth.sensitivity ?? 'unknown'}
                  </p>
                )}
                {level >= 4 && (
                  <div className="mt-1 font-mono text-xs text-muted-foreground" data-testid="expert-detail">
                    <button
                      type="button"
                      onClick={() => setOpen(isOpen ? null : hexagon.id)}
                      aria-expanded={isOpen}
                      className="underline focus-visible:outline focus-visible:outline-2"
                    >
                      {isOpen ? 'Hide raw reading' : 'Show raw reading'}
                    </button>
                    {isOpen && (
                      <dl className="mt-1 space-y-0.5">
                        <div><dt className="inline">Raw reading{tile.showValue ? '' : ' (not used, we make no claim)'}: </dt><dd className="inline">{raw}</dd></div>
                        <div><dt className="inline">What it captures: </dt><dd className="inline">{reg?.captures ?? 'unknown'}</dd></div>
                        <div><dt className="inline">Registry id: </dt><dd className="inline">{hexagon.id}</dd></div>
                        <div><dt className="inline">Capture status: </dt><dd className="inline">{captureStatus(hexagon.id, hexagon.value, {})}</dd></div>
                      </dl>
                    )}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
