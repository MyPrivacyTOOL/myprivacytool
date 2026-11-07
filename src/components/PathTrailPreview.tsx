import { useMemo, useState } from 'react';
import FootprintTrail, { type TrailTile } from './FootprintTrail';
import { baseLanes } from '@/lib/footprintTrail';
import type { Sensitivity, TileState } from '@/lib/footprintTrail';
import { HEXAGONS } from '../../shared/hexagon-registry/registry.js';

// Preview of the climbing footprint trail (design: Notion MPC-9546 strategy page, "Design direction, final version"). Shown on the unlisted
// /deep-research page only when the path-trail switch is on (src/config/pathTrail.ts, or ?path=1). It draws SAMPLE states for the Browser
// Fingerprint group and the two tiles every visitor has (Web and Email). It never reads or sends anything about the visitor.

// Bottom to top, left to right: what the browser draws, then the hardware, then what gives you away and what protects you.
const ORDER = [
  'canvas-fingerprint', 'webgl-fingerprint', 'audio-fingerprint', 'font-detection', 'screen-fingerprint', 'hardware-profile',
  'battery-fingerprint', 'media-devices', 'timezone-locale', 'webrtc-leak', 'extension-detection', 'fingerprint-protection',
];

type Scenario = 'first' | 'scan' | 'deleting';
const SCENARIOS: { id: Scenario; label: string }[] = [
  { id: 'first', label: 'First visit' },
  { id: 'scan', label: 'After a scan' },
  { id: 'deleting', label: 'Deleting data' },
];

interface RegistryHex { id: string; label: string; artwork?: { emoji?: string | null }; truth?: { sensitivity?: Sensitivity } }

function stateFor(scenario: Scenario, id: string): TileState {
  if (scenario === 'first') return 'notyet';
  if (scenario === 'deleting') {
    if (id === 'media-devices') return 'gone';
    if (id === 'font-detection' || id === 'battery-fingerprint') return 'deleting';
  }
  return 'held';
}

export default function PathTrailPreview() {
  const [scenario, setScenario] = useState<Scenario>('scan');
  const [signedUp, setSignedUp] = useState(false);

  const tiles: TrailTile[] = useMemo(() => {
    const byId = new Map((HEXAGONS as RegistryHex[]).map((h) => [h.id, h]));
    return ORDER.flatMap((id) => {
      const h = byId.get(id);
      if (!h) return [];
      return [{ id, label: h.label, emoji: h.artwork?.emoji ?? undefined, sensitivity: h.truth?.sensitivity, state: stateFor(scenario, id) }];
    });
  }, [scenario]);

  const lanes: TrailTile[] = baseLanes({ webScan: true, emailSignedUp: signedUp }).map((l) => ({ id: l.id, label: l.label, emoji: l.emoji, state: l.state }));

  return (
    <section className="mt-12 rounded-lg border border-border p-5" aria-labelledby="path-preview-heading" data-testid="path-trail-preview">
      <h2 id="path-preview-heading" className="text-xl font-semibold text-foreground">The Path (preview)</h2>
      <p className="mt-1 text-sm text-muted-foreground">
        A design preview, not built into the scan. Example, not your data. Footprints climb the honeycomb. Colour shows the risk of the data under each print:
        black is no risk, then dark red, brighter red, brightest red. Dark green is where the trail stepped.
      </p>

      <h3 className="mt-6 text-base font-semibold text-foreground">Always two tiles</h3>
      <p className="text-sm text-muted-foreground">If you look at the site we have Web. If you sign up we have Email.</p>
      <label className="mt-2 flex items-center gap-2 text-sm text-foreground">
        <input type="checkbox" checked={signedUp} onChange={(e) => setSignedUp(e.target.checked)} />
        Pretend I signed up to the newsletter
      </label>
      <div className="mt-3 max-w-md">
        <FootprintTrail tiles={lanes} ariaLabel="Web and Email: the two tiles every visitor has" />
      </div>

      <h3 className="mt-8 text-base font-semibold text-foreground">Browser Fingerprint</h3>
      <div role="group" aria-label="Choose an example" className="mt-2 flex flex-wrap gap-2">
        {SCENARIOS.map((s) => (
          <button key={s.id} type="button" aria-pressed={scenario === s.id} onClick={() => setScenario(s.id)}
            className={`rounded-full border px-3 py-1 text-sm ${scenario === s.id ? 'border-foreground bg-foreground text-background' : 'border-border text-foreground'}`}>
            {s.label}
          </button>
        ))}
      </div>
      <div className="mt-3 max-w-lg">
        <FootprintTrail tiles={tiles} ariaLabel={`Browser Fingerprint, example: ${SCENARIOS.find((s) => s.id === scenario)?.label}`} />
      </div>
    </section>
  );
}
