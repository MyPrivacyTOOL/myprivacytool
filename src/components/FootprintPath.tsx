import { useEffect, useMemo, useState } from 'react';
import { HEXAGONS } from '../../shared/hexagon-registry/registry.js';
import { SHADES, type PathTile } from '@/config/footprintPathTiles';
import {
  aheadTiles, answerPrints, badgeText, buildArrivalPrints, counts, currentTile, shadeLabel, tileCopy,
  type Answer, type Answers, type ArrivalHexagon, type Print,
} from '@/lib/footprintPath';

// MPC-10614: the Footprint Path (design brief v1, Telegram arrival; signed off 2026-11-09). Behind the VITE_FOOTPRINT_PATH switch / ?path=1 (src/config/footprintPath.ts).
// Hard rules from the brief, kept here in the markup:
//  - A tile is NEVER coloured, in light or dark. Every hexagon outline is an SVG polygon with fill="none"; only a footprint (a print) carries colour, S1-S5, always with pips and the word.
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

/** A hexagon outline. fill is ALWAYS none: the tile has no colour. */
function Outline({ w, h, kind }: { w: number; h: number; kind: 'ink' | 'grey' | 'dashed' | 'thick' }) {
  const stroke = kind === 'grey' ? 'text-muted-foreground' : 'text-foreground';
  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} className={`absolute inset-0 ${stroke}`} aria-hidden="true" focusable="false" data-outline={kind}>
      <polygon points={HEX(w, h)} fill="none" stroke="currentColor" strokeWidth={kind === 'thick' ? 4 : kind === 'grey' ? 1 : 2}
        strokeDasharray={kind === 'dashed' ? '6 5' : undefined} strokeLinejoin="round" />
    </svg>
  );
}

function PrintMark({ print, size, land }: { print: Print; size: number; land: boolean }) {
  const sh = SHADES[print.shade];
  const h = size * 1.15;
  return (
    <svg width={size} height={h} viewBox={`0 0 ${size} ${h}`} className={land ? 'fp-land' : undefined} aria-hidden="true" focusable="false" data-print-fill={sh.hex} data-accepted={print.accepted ? 'yes' : undefined}>
      {/* a footprint: the one place colour is used. "You accepted this" is an outline with no fill (brief decision 2). */}
      <polygon points={HEX(size, h, 1)} fill={print.accepted ? 'none' : sh.hex} stroke={print.accepted ? 'currentColor' : sh.hex} strokeWidth="2" />
      <text x="50%" y="55%" textAnchor="middle" dominantBaseline="middle" fontSize={size * 0.3} fontWeight="700" fill={print.accepted ? 'currentColor' : sh.dark ? '#ffffff' : '#1a1a1a'}>{`S${print.shade}`}</text>
    </svg>
  );
}

const SOURCE_TAG: Record<Print['source'], string> = { taken: 'taken', checked: 'checked', given: 'given' };

function BehindTile({ print, land }: { print: Print | null; land: boolean }) {
  // print === null renders the "nothing returned" tile (thin grey, solid): see-through never means safe, so it says so in words.
  const lab = print ? shadeLabel(print.shade) : null;
  return (
    <li className="flex w-[110px] flex-col items-center text-center" data-testid={print ? `print-${print.key}` : 'print-not-returned'} data-print={print ? print.key : undefined}>
      <div className="relative" style={{ width: 74, height: 85 }}>
        <Outline w={74} h={85} kind={print ? 'ink' : 'grey'} />
        {print && <div className="absolute inset-0 flex items-center justify-center"><PrintMark print={print} size={36} land={land} /></div>}
      </div>
      <span className="mt-1 text-xs font-medium leading-tight text-foreground">{print ? print.label : 'Public profile'}</span>
      {print ? (
        <>
          {print.value && <span className="break-all text-xs text-foreground" data-testid={`print-value-${print.key}`}>{print.value}</span>}
          <span className="text-[11px] text-muted-foreground">{SOURCE_TAG[print.source]}</span>
          <span className="text-[11px] text-foreground" data-testid={`print-shade-${print.key}`}>{lab!.text} <span aria-label={`${print.shade} pips`}>{lab!.pips}</span></span>
        </>
      ) : <span className="text-[11px] text-muted-foreground">not returned to this bot</span>}
    </li>
  );
}

const Chip = ({ children, testid }: { children: React.ReactNode; testid?: string }) => (
  <span className="inline-block rounded border border-foreground px-1.5 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-foreground" data-testid={testid}>{children}</span>
);

function AheadTile({ tile }: { tile: PathTile }) {
  return (
    <li className="flex w-[100px] flex-col items-center text-center" data-testid={`ahead-${tile.n}`}>
      <div className="relative" style={{ width: 74, height: 85 }}>
        <Outline w={74} h={85} kind="dashed" />
        {/* a ghost print: dashed, no fill, so it reads as "what you would see", never as a colour */}
        <svg width="36" height="41" viewBox="0 0 36 41" className="absolute left-[19px] top-[22px] text-muted-foreground" aria-hidden="true" focusable="false">
          <polygon points={HEX(36, 41, 1)} fill="none" stroke="currentColor" strokeWidth="1.5" strokeDasharray="3 3" />
        </svg>
      </div>
      <span className="mt-1 text-xs font-medium text-foreground">{tile.shortLabel}</span>
      <span className="text-[11px] text-muted-foreground">{tile.kind} · {tile.status}</span>
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
      <ol className="mt-3 flex flex-wrap justify-center gap-x-2 gap-y-4 border-l-2 border-dotted border-muted-foreground/50 pl-3" aria-label="Footprints you have left, newest last" data-testid="path-behind">
        {arrival.map((p) => <BehindTile key={p.key} print={p} land={land} />)}
        {allowListedTestAccount && !arrival.some((p) => p.key === 'profile') && <BehindTile print={null} land={land} />}
        {stepPrints.map((p) => <BehindTile key={p.key} print={p} land={land} />)}
      </ol>

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
      <ol className="mt-3 flex justify-center gap-2" aria-label="Hexagons ahead" data-testid="path-ahead">
        {ahead.map((t) => <AheadTile key={t.n} tile={t} />)}
      </ol>

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

