import { useEffect, useState } from 'react';
import FootprintPath from '@/components/FootprintPath';
import { footprintPathEnabled, footprintPathPreview, previewAllowListed, previewFrame } from '@/config/footprintPath';
import { useTelegramHandoff } from '@/lib/telegramHandoff';
import { recipientFetch } from '@/lib/recipientClient';
import type { Answers, ArrivalHexagon } from '@/lib/footprintPath';

// MPC-10614: where the path gets its data. Mounted once on the home page; renders nothing at all when the switch is off.
//  - ?path=1 with no Telegram session: SAMPLE DATA (the owner's test-account shape), clearly marked. ?frame=confirmed|prize pre-sets the review frames, ?test=1 the test-account shape.
//  - A Telegram session (the one-time /d/<uuid> link, same cookie the Telegram dashboard uses): the bot's real arrival values from /api/dashboard.
//  - Switch on by build flag, no session: an empty state. Sample data is never shown to a visitor who did not ask for the preview.
// The path never stores anything. MPC-10621: /api/dashboard says (a boolean only, from the bot's allow-list) whether the sender is a test account: five prints; anything else, or a missing flag, is a real user (four prints).

const SAMPLE: ArrivalHexagon[] = [
  { id: 'tg.username', state: 'returned', value: '@krispyking5' }, { id: 'tg.first_name', state: 'returned', value: 'Krispy' }, { id: 'tg.last_name', state: 'returned', value: 'King' },
  { id: 'tg.language', state: 'returned', value: 'en' }, { id: 'tg.numeric_id', state: 'returned', value: '6812345678' },
  { id: 'tg.photo_current', state: 'returned', value: 'photo' }, { id: 'tg.message_time', state: 'returned', value: 'sample time' }, { id: 'tg.message_text', state: 'returned', value: 'scan me' }, { id: 'tg.update_counter', state: 'returned', value: '1042' },
];
const FRAMES: Record<string, Answers> = { arrival: {}, confirmed: { 1: 'yes' }, prize: { 1: 'yes', 2: 'yes', 3: 'done' } };

interface Live { hexes: ArrivalHexagon[]; allowListed: boolean }

function useLiveArrival(active: boolean): Live | null {
  const [hexes, setHexes] = useState<Live | null>(null);
  useEffect(() => {
    if (!active) return;
    const ctl = new AbortController();
    recipientFetch('cloudflare-edge', '/api/dashboard', { credentials: 'same-origin', cache: 'no-store', signal: ctl.signal }, ['page_load'])
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { baseline?: { state?: string; hexagons?: ArrivalHexagon[]; allow_listed_test_account?: unknown } } | null) => {
        const list = d?.baseline?.state === 'available' ? d.baseline.hexagons : null;
        if (Array.isArray(list)) setHexes({ allowListed: d?.baseline?.allow_listed_test_account === true, hexes: list.filter((h) => typeof h?.id === 'string' && h.id.startsWith('tg.')).map((h) => ({ id: h.id, state: h.state, value: h.value ?? null })) });
      })
      .catch(() => { /* no session or an error: no claim */ });
    return () => ctl.abort();
  }, [active]);
  return hexes;
}

/** With the switch off this renders null and runs no hook, so no request is made and the page is exactly as before. */
export default function FootprintPathHost() {
  return footprintPathEnabled() ? <Inner /> : null;
}

function Inner() {
  const handoff = useTelegramHandoff();
  const live = useLiveArrival(true);
  const preview = footprintPathPreview();
  if (live) return <FootprintPath hexagons={live.hexes} allowListedTestAccount={live.allowListed} handoffIds={handoff.ids} />;
  if (preview) return <FootprintPath sample hexagons={SAMPLE} allowListedTestAccount={previewAllowListed()} initialAnswers={FRAMES[previewFrame()]} handoffIds={handoff.ids} />;
  return <section className="mx-auto max-w-[390px] px-4 py-6" data-testid="footprint-path"><p className="text-sm text-muted-foreground" data-testid="path-empty">Open the one-time link from the Telegram bot to see your path.</p></section>;
}
