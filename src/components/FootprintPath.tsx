import { useEffect, useMemo, useState } from 'react';
import { HEXAGONS } from '../../shared/hexagon-registry/registry.js';
import { SHADES, type PathTile } from '@/config/footprintPathTiles';
import {
  aheadTiles, answerPrints, badgeText, buildArrivalPrints, counts, currentTile, shadeLabel, tileCopy,
  type Answer, type Answers, type ArrivalHexagon, type Print,
} from '@/lib/footprintPath';

// MPC-10614: the Footprint Path (design brief v1, Telegram arrival; signed off 2026-11-09). Behind the VITE_FOOTPRINT_PATH switch / ?path=1 (src/config/footprintPath.ts).
// Hard rules from the brief, kept here in the markup:
//  - MPC-10621 (owner decision, 2026-11-23, reverses brief v1 "tiles never coloured"): a Behind-you tile that carries a print is filled with that print's S1-S5 shade, like the scan. Every other hexagon
//    (grey not-returned, dashed ahead, thick current) stays an unfilled outline. Colour is never the only clue: pips and the shade word are always on the tile.
//  - Outlines: behind with a print = solid ink; behind with nothing returned = thin grey solid; ahead = dashed; current = thick ink.
//  - The path has no end: no total, no ratio, no percentage, no bar, no score, no "complete" wording. The badge is the only count.
//  - A tile whose check does not run today renders disabled with its Live / In build / Planned marker. Only keys in LIVE_HANDLERS are wired to something real.

/** Handlers that are wired to a check that really runs today. 'passive' = the tile consumes a result that arrives elsewhere (the Telegram to web handoff). */
export const LIVE_HANDLERS: Record<string, 'passive'> = { telegram_web_handoff: 'passive' };

export const usePrefersReducedMotion = (): boolean => {
  const get = () => { try { return typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch { return false; } };
  const [reduced, setReduced] = useState<boolean>(get);
  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return;
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    const on = () => setReduced(mq.matches);
    mq.addEventListener?.('change', on);
    return () => mq.removeEventListener?.('change', on);
  }, []);
  return reduced;
};

const HEX = (w: number, h: number, inset = 2) => {
  const x = w / 2, q = h / 4;
  return [[x, inset], [w - inset, q + inset / 2], [w - inset, 3 * q - inset / 2], [x, h - inset], [inset, 3 * q - inset / 2], [inset, q + inset / 2]].map((p) => p.join(',')).join(' ');
};

/** A hexagon outline. fill is none unless a Behind-you tile passes its print's shade colour. */
function Outline({ w, h, kind, fill }: { w: number; h: number; kind: 'ink' | 'grey' | 'dashed' | 'thick'; fill?: string }) {
  const stroke = kind === 'grey' ? 'text-muted-foreground' : 'text-foreground';
  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} className={`absolute inset-0 ${stroke}`} aria-hidden="true" focusable="false" data-outline={kind} data-tile-fill={fill}>
      <polygon points={HEX(w, h)} fill={fill ?? 'none'} stroke="currentColor" strokeWidth={kind === 'thick' ? 4 : kind === 'grey' ? 1 : 2}
        strokeDasharray={kind === 'dashed' ? '6 5' : undefined} strokeLinejoin="round" />
    </svg>
  );
}

function PrintMark({ print, size, land, onFilled = false }: { print: Print; size: number; land: boolean; onFilled?: boolean }) {
  const sh = SHADES[print.shade];
  const h = size * 1.15;
  return (
    <svg width={size} height={h} viewBox={`0 0 ${size} ${h}`} className={land ? 'fp-land' : undefined} aria-hidden="true" focusable="false" data-print-fill={sh.hex} data-accepted={print.accepted ? 'yes' : undefined}>
      {/* a footprint: the one place colour is used. "You accepted this" is an outline with no fill (brief decision 2). */}
      <polygon points={HEX(size, h, 1)} fill={print.accepted || onFilled ? 'none' : sh.hex} stroke={print.accepted || onFilled ? 'currentColor' : sh.hex} strokeWidth="2" />
      <text x="50%" y="55%" textAnchor="middle" dominantBaseline="middle" fontSize={size * 0.3} fontWeight="700" fill={print.accepted ? 'currentColor' : sh.dark ? '#ffffff' : '#1a1a1a'}>{`S${print.shade}`}</text>
    </svg>
  );
}

// MPC-10621 layout: the same interlocking honeycomb as the web scan (icon, name and value inside the hexagon), in the path's one 390px column.
// Tiles stay uncoloured outlines (brief rule); only the S1-S5 print carries colour. Rows alternate 3 and 2 hexagons so the rows lock together.
const HW = 112, HH = Math.round(HW * 1.1547), GAP = 2, PER_ROW = 3, ROW_STEP = Math.round(HH * 0.75 + GAP * 0.87);
const ICONS: Record<string, string> = { username: '🏷️', name: '👤', language: '🌐', numeric_id: '🔢', profile: '🪪' };

function honeyPos(i: number): { left: number; top: number } {
  let row = 0, start = 0, cap = PER_ROW;
  while (i >= start + cap) { start += cap; row += 1; cap = row % 2 === 0 ? PER_ROW : PER_ROW - 1; }
  const x0 = ((PER_ROW - cap) * (HW + GAP)) / 2;
  return { left: Math.round(x0 + (i - start) * (HW + GAP)), top: row * ROW_STEP };
}

/** A flat <ol> whose <li> children sit in honeycomb positions. */
function Honeycomb({ count, testid, label, children }: { count: number; testid: string; label: string; children: React.ReactNode }) {
  const last = count ? honeyPos(count - 1) : { left: 0, top: 0 };
  return (
    <ol className="relative mx-auto mt-3" style={{ width: PER_ROW * (HW + GAP) - GAP, height: last.top + HH }} aria-label={label} data-testid={testid}>
      {children}
    </ol>
  );
}

function BehindTile({ print, land, index }: { print: Print | null; land: boolean; index: number }) {
  // print === null renders the "nothing returned" tile (thin grey, solid, unfilled): see-through never means safe, so it says so in words.
  const lab = print ? shadeLabel(print.shade) : null;
  const pos = honeyPos(index);
  const filled = !!print && !print.accepted; // "you accepted this" stays an unfilled outline (brief decision 2)
  const sh = print ? SHADES[print.shade] : null;
  const tone = filled && sh ? (sh.dark ? 'text-white' : 'text-neutral-900') : 'text-foreground';
  const muted = filled ? tone : 'text-muted-foreground';
  return (
    <li className="absolute" style={{ width: HW, height: HH, left: pos.left, top: pos.top }} data-testid={print ? `print-${print.key}` : 'print-not-returned'} data-print={print ? print.key : undefined}>
      <Outline w={HW} h={HH} kind={print ? 'ink' : 'grey'} fill={filled && sh ? sh.hex : undefined} />
      <div className={`absolute inset-0 flex flex-col items-center justify-center gap-px px-5 pb-1 pt-2 text-center ${tone}`}>
        <div className="flex items-center gap-1">
          <span className="text-base leading-none" aria-hidden="true">{print ? ICONS[print.key] ?? '👣' : '🔍'}</span>
          {print && <PrintMark print={print} size={20} land={land} onFilled={filled} />}
        </div>
        <span className={`text-[9px] font-semibold uppercase leading-[1.1] tracking-wide ${tone}`}>{print ? print.label : 'Public profile'}</span>
        {print ? (
          <>
            {print.value && <span className={`max-w-full break-all text-[9px] leading-tight ${tone}`} data-testid={`print-value-${print.key}`}>{print.value}</span>}
            <span className={`whitespace-nowrap text-[8px] leading-tight ${tone}`} data-testid={`print-shade-${print.key}`}>{lab!.text} <span aria-label={`${print.shade} pips`}>{lab!.pips}</span></span>
          </>
        ) : <span className={`text-[9px] italic leading-tight ${muted}`}>not returned to this bot</span>}
      </div>
    </li>
  );
}

const Chip = ({ children, testid }: { children: React.ReactNode; testid?: string }) => (
  <span className="inline-block rounded border border-foreground px-1.5 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-foreground" data-testid={testid}>{children}</span>
);

function AheadTile({ tile, index }: { tile: PathTile; index: number }) {
  const pos = honeyPos(index);
  return (
    <li className="absolute" style={{ width: HW, height: HH, left: pos.left, top: pos.top }} data-testid={`ahead-${tile.n}`}>
      <Outline w={HW} h={HH} kind="dashed" />
      <div className="absolute inset-0 flex flex-col items-center justify-center gap-px px-5 pb-1 pt-2 text-center">
        <div className="flex items-center gap-1">
          <span className="text-base leading-none" aria-hidden="true">👣</span>
          {/* a ghost print: dashed, no fill, so it reads as "what you would see", never as a colour */}
          <svg width="18" height="21" viewBox="0 0 18 21" className="text-muted-foreground" aria-hidden="true" focusable="false">
            <polygon points={HEX(18, 21, 1)} fill="none" stroke="currentColor" strokeWidth="1.5" strokeDasharray="3 2" />
          </svg>
        </div>
        <span className="text-[9px] font-semibold uppercase leading-[1.1] tracking-wide text-foreground">{tile.shortLabel}</span>
        <span className="text-[8px] leading-tight text-muted-foreground">{tile.kind} · {tile.status}</span>
      </div>
    </li>
  );
}

interface Props {
  /** What the bot really received (tg.* hexagons with state and value), from /api/dashboard. */
  hexagons: ArrivalHexagon[];
  /** An allow-listed test account (brief decision 4). Real users get four arrival prints, test accounts five. */
  allowListedTestAccount: boolean;
  /** Sample data (preview only): shown with a visible marker. */
  sample?: boolean;
  /** Answers already given (preview frames; tests). */
  initialAnswers?: Answers;
  /** Ids from the Telegram to web handoff (src/lib/telegramHandoff.ts): the one live handler. Ids only, never values. */
  handoffIds?: string[];
  /** Extra handler keys treated as live. Tests only: production wiring is LIVE_HANDLERS. */
  extraLiveHandlers?: string[];
  /** Optional values for the 54 web checks in the technical panel. */
  webChecks?: { id: string; label: string; value?: string | null }[];
}

const SENT_WITH_EVERY_MESSAGE: [string, string][] = [['tg.message_time', 'Message time'], ['tg.message_text', 'What you typed'], ['tg.update_counter', 'Bot update counter']];
const NEVER_GIVEN = 'Telegram does not give us: your phone number (unless you tap share), when you were last seen, your IP address, your device.';

export default function FootprintPath({ hexagons, allowListedTestAccount, sample = false, initialAnswers, handoffIds = [], extraLiveHandlers = [], webChecks }: Props) {
  const reduced = usePrefersReducedMotion();
  const [local, setLocal] = useState<Answers>(initialAnswers ?? {});
  // The web handoff is the one live handler: when its ids arrived, tile 5 is done. It leaves no print (the checks go to the technical panel).
  const answers: Answers = useMemo(() => ({ ...local, ...(handoffIds.length ? { 5: 'done' as Answer } : {}) }), [local, handoffIds.length]);

  const arrival = useMemo(() => buildArrivalPrints(hexagons, allowListedTestAccount), [hexagons, allowListedTestAccount]);
  const stepPrints = useMemo(() => answerPrints(answers), [answers]);
  const { n, m } = counts(arrival, answers);
  const cur = currentTile(answers);
  const ahead = aheadTiles(answers);

  const name = hexagons.filter((h) => (h.id === 'tg.first_name' || h.id === 'tg.last_name') && h.state === 'returned').map((h) => h.value).filter(Boolean).join(' ');
  const handle = hexagons.find((h) => h.id === 'tg.username' && h.state === 'returned')?.value ?? null;
  const live = (t: PathTile) => extraLiveHandlers.includes(t.handlerKey);
  const passive = (t: PathTile) => LIVE_HANDLERS[t.handlerKey] === 'passive';
  const respond = (t: PathTile, a: Answer) => setLocal((s) => ({ ...s, [t.n]: a }));

  const sentValues = new Map(hexagons.map((h) => [h.id, h]));
  const registryChecks: { id: string; label: string; value?: string | null }[] = webChecks ?? (HEXAGONS as { id: string; label: string }[]).map((h) => ({ id: h.id, label: h.label }));
  const land = !reduced;

  return (
    <section className="mx-auto w-full max-w-[390px] px-4 py-6" aria-label="Your Footprint Path" data-testid="footprint-path" data-motion={reduced ? 'reduced' : 'full'}>
      <style>{`@keyframes fp-land{from{opacity:0}to{opacity:1}}.fp-land{animation:fp-land .35s ease-out}@media (prefers-reduced-motion: reduce){.fp-land{animation:none}}`}</style>
      <p className="text-xs text-muted-foreground">Channel: Telegram</p>
      {sample && <p className="mt-1 text-xs font-semibold uppercase tracking-wide text-foreground" data-testid="path-sample">Sample data, preview only</p>}
      <p className="mt-2 text-base font-semibold text-foreground" data-testid="path-badge" role="status">{badgeText(n, m)}</p>

      <h2 className="mt-6 text-sm font-semibold uppercase tracking-wider text-foreground">Behind you</h2>
      <Honeycomb count={arrival.length + (allowListedTestAccount && !arrival.some((p) => p.key === 'profile') ? 1 : 0) + stepPrints.length} testid="path-behind" label="Footprints you have left, newest last">
        {[
          ...arrival.map((p) => ({ k: p.key, p })),
          ...(allowListedTestAccount && !arrival.some((p) => p.key === 'profile') ? [{ k: 'not-returned', p: null as Print | null }] : []),
          ...stepPrints.map((p) => ({ k: p.key, p })),
        ].map((t, i) => <BehindTile key={t.k} print={t.p} land={land} index={i} />)}
      </Honeycomb>

      {stepPrints.length > 0 && (() => {
        const last = stepPrints[stepPrints.length - 1];
        return <p className="mt-4 text-sm text-foreground" data-testid="path-last-education"><span className="font-medium">{last.label}.</span> What someone could do with it: {last.education!.charAt(0).toLowerCase() + last.education!.slice(1)}</p>;
      })()}

      <h2 className="mt-8 text-sm font-semibold uppercase tracking-wider text-foreground">You are here</h2>
      {cur ? (
        <div className="mt-3 flex flex-col items-center" data-testid="path-current" data-tile={cur.n}>
          <div className="relative" style={{ width: 240, height: 276 }}>
            <Outline w={240} h={276} kind="thick" />
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-1.5 px-9 text-center">
              <div className="flex gap-1.5"><Chip testid="chip-kind">{cur.kind}</Chip><Chip testid="chip-status">{cur.status}</Chip></div>
              <p className="text-[15px] font-medium leading-snug text-foreground" data-testid="current-copy">{tileCopy(cur, { name, handle })}</p>
              {cur.confidence && <p className="text-xs text-foreground" data-testid="current-confidence">{cur.confidence.word} <span aria-hidden="true">{'●'.repeat(cur.confidence.pips)}{'○'.repeat(5 - cur.confidence.pips)}</span></p>}
            </div>
          </div>
          <p className="mt-3 text-sm text-foreground" data-testid="current-education">What someone could do with it: {cur.education.charAt(0).toLowerCase() + cur.education.slice(1)}</p>
          {cur.consentGate && <p className="mt-1 text-xs text-muted-foreground" data-testid="current-gate">Before you step: {cur.consentGate}</p>}
          {cur.notCheckedNote && <p className="mt-1 text-sm text-foreground" data-testid="current-not-checked">{cur.notCheckedNote}{cur.link && <> <a href={cur.link.href} target="_blank" rel="noopener noreferrer" className="underline">{cur.link.label}</a></>}</p>}
          {passive(cur) && <p className="mt-1 text-xs text-muted-foreground">This opens from the one-time link the bot sends you. Nothing to press here.</p>}
          <div className="mt-3 flex w-full gap-3">
            {(() => {
              const enabled = live(cur) && !passive(cur);
              const [yes, no] = cur.kind === 'GUESS' ? ["Yes, that's me", 'Not me'] : ['Step', 'Not now'];
              const cls = 'min-h-[44px] flex-1 rounded-md border border-foreground px-3 text-sm font-medium text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 disabled:cursor-not-allowed disabled:opacity-50';
              return (<>
                <button type="button" className={cls} disabled={!enabled} onClick={() => respond(cur, cur.kind === 'GUESS' ? 'yes' : 'done')} data-testid="btn-yes">{yes}</button>
                <button type="button" className={cls} disabled={!enabled} onClick={() => respond(cur, cur.kind === 'GUESS' ? 'not_me' : 'not_now')} data-testid="btn-no">{no}</button>
              </>);
            })()}
          </div>
          {!(live(cur) && !passive(cur)) && <p className="mt-2 text-xs text-muted-foreground" data-testid="current-disabled-note">{cur.status} — this step cannot be taken yet.</p>}
        </div>
      ) : <p className="mt-3 text-sm text-muted-foreground" data-testid="path-no-current">Nothing waiting right now.</p>}

      <h2 className="mt-8 text-sm font-semibold uppercase tracking-wider text-foreground">Ahead</h2>
      <Honeycomb count={ahead.length} testid="path-ahead" label="Hexagons ahead">
        {ahead.map((t, i) => <AheadTile key={t.n} tile={t} index={i} />)}
      </Honeycomb>

      <details className="mt-8 rounded-md border border-border" data-testid="path-technical">
        <summary className="cursor-pointer px-3 py-3 text-sm font-medium text-foreground">Technical details</summary>
        <div className="space-y-4 px-3 pb-4 text-sm text-foreground">
          <div>
            <h3 className="font-semibold">{registryChecks.length} web checks</h3>
            <p className="text-xs text-muted-foreground">These run in your browser on the web page. Their values are in your web scan.</p>
            <ul className="mt-1 columns-2 text-xs">{registryChecks.map((c) => <li key={c.id}>{c.label}{c.value ? `: ${c.value}` : ''}</li>)}</ul>
            {handoffIds.length > 0 && <p className="mt-1 text-xs" data-testid="handoff-received">Telegram checks received through your browser link: {handoffIds.length}. Only which checks ran was shared, not your values.</p>}
          </div>
          <div>
            <h3 className="font-semibold">Sent with every message</h3>
            <ul className="text-xs">{SENT_WITH_EVERY_MESSAGE.map(([id, label]) => <li key={id}>{label}: {sentValues.get(id)?.state === 'returned' && sentValues.get(id)?.value ? sentValues.get(id)!.value : 'not returned to this bot'}</li>)}</ul>
          </div>
          <div>
            <h3 className="font-semibold">What Telegram does not send</h3>
            <p className="text-xs" data-testid="never-given">{NEVER_GIVEN}</p>
          </div>
        </div>
      </details>
    </section>
  );
}

