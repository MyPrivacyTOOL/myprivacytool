import { useMemo, useState } from 'react';
import FootprintTrail, { type TrailTile } from './FootprintTrail';
import type { Sensitivity, TileState } from '@/lib/footprintTrail';
import { HEXAGONS } from '../../shared/hexagon-registry/registry.js';
import { TRAIL_GROUPS } from '@/config/pathTrailGroups';
import { CHANNEL_GROUPS, channelTiles } from '@/config/pathTrailChannels';

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
  const [pretendAll, setPretendAll] = useState(false);

  const tiles: TrailTile[] = useMemo(() => {
    const byId = new Map((HEXAGONS as RegistryHex[]).map((h) => [h.id, h]));
    return ORDER.flatMap((id) => {
      const h = byId.get(id);
      if (!h) return [];
      return [{ id, label: h.label, emoji: h.artwork?.emoji ?? undefined, sensitivity: h.truth?.sensitivity, state: stateFor(scenario, id) }];
    });
  }, [scenario]);

  // The journey, bottom to top: where they came from (the registry's "How You Found Us"), the two tiles every visitor has, then what we do not
  // know and cannot guess. Nothing is asked or collected here; the dotted footprints only show where a visitor could choose to go next.
  const journey: TrailTile[] = useMemo(() => {
    const ref = (HEXAGONS as RegistryHex[]).find((h) => h.id === 'referrer');
    return [
      { id: 'origin', label: ref?.label ?? 'How You Found Us', emoji: ref?.artwork?.emoji ?? '📣', state: 'origin', level: 'none', caption: 'an ad on Facebook, Instagram or YouTube' },
      { id: 'web', label: 'Web', emoji: '🌐', state: 'held', level: 'low', depth: 1, caption: 'you looked at the site' },
      { id: 'email', label: 'Email', emoji: '✉️', state: signedUp ? 'held' : 'notyet', level: 'low', depth: 1, caption: signedUp ? 'you signed up' : undefined },
      { id: 'first-name', label: 'First name', emoji: '🪪', state: 'want' },
      { id: 'username', label: 'Username', emoji: '🏷️', state: 'want' },
      { id: 'mobile', label: 'Mobile number', emoji: '📱', state: 'want' },
    ];
  }, [signedUp]);

  return (
    <section className="mt-12 rounded-lg border border-border p-5" aria-labelledby="path-preview-heading" data-testid="path-trail-preview">
      <h2 id="path-preview-heading" className="text-xl font-semibold text-foreground">The Path (preview)</h2>
      <p className="mt-1 text-sm text-muted-foreground">
        A design preview, not built into the scan. Example, not your data. Footprints climb the honeycomb. Colour shows the risk of the data under each print:
        black is no risk, then dark red, brighter red, brightest red. Dark green is where the trail stepped.
      </p>

      <h3 className="mt-6 text-base font-semibold text-foreground">The journey</h3>
      <p className="text-sm text-muted-foreground">
        Always two tiles: if you look at the site we have Web, and if you sign up we have Email. Below them, where you came from, shown lightly.
        Above them, what we do not know and cannot guess, as transparent hexagons. Dotted footprints show where you could choose to go next. Nothing is asked or collected here.
      </p>
      <label className="mt-2 flex items-center gap-2 text-sm text-foreground">
        <input type="checkbox" checked={signedUp} onChange={(e) => setSignedUp(e.target.checked)} />
        Pretend I signed up to the newsletter
      </label>
      <div className="mt-3 max-w-md">
        <FootprintTrail tiles={journey} rows={[1, 2, 3]} ariaLabel="The journey: where you came from, Web and Email, and what we do not know yet" />
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

      <h3 className="mt-10 text-base font-semibold text-foreground">The other seven groups</h3>
      <p className="text-sm text-muted-foreground">
        Same rules in every group. The order of tiles inside a group is a proposal. Where a tile shows a clear hexagon with a black foot, we checked and hold nothing;
        a hatched tile cannot be checked from this device.
      </p>
      <div className="mt-4 grid gap-8 sm:grid-cols-2 lg:grid-cols-3" data-testid="path-trail-groups">
        {TRAIL_GROUPS.map((g) => {
          const byId = new Map((HEXAGONS as RegistryHex[]).map((h) => [h.id, h]));
          const groupTiles: TrailTile[] = g.order.flatMap((id) => {
            const h = byId.get(id);
            if (!h) return [];
            const state: TileState = scenario === 'first' ? 'notyet' : g.sample?.[id] ?? 'held';
            return [{ id, label: h.label, emoji: h.artwork?.emoji ?? undefined, sensitivity: h.truth?.sensitivity, state }];
          });
          return (
            <figure key={g.group} className="min-w-0">
              <figcaption className="mb-1 text-sm font-semibold text-foreground">{g.group}</figcaption>
              <p className="mb-2 text-xs text-muted-foreground">{g.story}</p>
              <FootprintTrail tiles={groupTiles} rows={g.rows} ariaLabel={`${g.group}, example: ${SCENARIOS.find((s) => s.id === scenario)?.label}`} />
            </figure>
          );
        })}
      </div>

      <h3 className="mt-10 text-base font-semibold text-foreground">Email, dark web, WhatsApp and Facebook Messenger</h3>
      <p className="text-sm text-muted-foreground">
        Taken from the tile catalogue, so each caption says what is true today: live, planned, later, or not planned. WhatsApp and Messenger are marked
        not planned today by an earlier owner decision (MPC-8689); this picture does not change that.
      </p>
      <label className="mt-2 flex items-center gap-2 text-sm text-foreground">
        <input type="checkbox" checked={pretendAll} onChange={(e) => setPretendAll(e.target.checked)} />
        Pretend we hold everything (to see the trail)
      </label>
      <div className="mt-4 grid gap-8 sm:grid-cols-2 lg:grid-cols-3" data-testid="path-trail-channels">
        {CHANNEL_GROUPS.map((g) => {
          const tiles: TrailTile[] = channelTiles(g.key).map((t) => ({
            id: t.id,
            label: t.label.replace(/^If they email us: /, ''),
            emoji: t.emoji,
            sensitivity: t.sensitivity,
            state: pretendAll ? 'held' : t.today,
            caption: pretendAll ? undefined : t.caption,
          }));
          return (
            <figure key={g.key} className="min-w-0">
              <figcaption className="mb-1 text-sm font-semibold text-foreground">{g.title}</figcaption>
              <p className="mb-2 text-xs text-muted-foreground">{g.story}</p>
              <FootprintTrail tiles={tiles} rows={g.rows} ariaLabel={`${g.title}, ${pretendAll ? 'example if we held everything' : 'as it is today'}`} />
            </figure>
          );
        })}
      </div>
    </section>
  );
}
