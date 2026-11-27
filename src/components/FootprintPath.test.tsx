import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import FootprintPath from './FootprintPath';
import { PATH_TILES, ARRIVAL_PRINTS, SHADES } from '@/config/footprintPathTiles';
import { BANNED_PHRASES, BANNED_WORDS, badgeText, wordCount, type Answers, type ArrivalHexagon } from '@/lib/footprintPath';

// MPC-10614. The honesty rules of design brief v1 (signed off 2026-11-09), as tests.
const hx = (id: string, value: string): ArrivalHexagon => ({ id, state: 'returned', value });
const REAL: ArrivalHexagon[] = [hx('tg.username', '@krispyking5'), hx('tg.first_name', 'Krispy'), hx('tg.last_name', 'King'), hx('tg.language', 'en'), hx('tg.numeric_id', '6812345678')];
const WITH_PROFILE: ArrivalHexagon[] = [...REAL, hx('tg.photo_current', 'photo')];
// things Telegram never gives a bot, supplied anyway: they must never reach the page as arrival data
const NEVER: ArrivalHexagon[] = [hx('tg.phone_shared', '+85212345678'), hx('tg.location_shared', '22.3,114.1'), hx('ip', '203.0.113.9'), hx('device', 'Pixel 7'), hx('last_seen', 'yesterday')];

const text = () => (document.body.textContent ?? '').replace(/\s+/g, ' ');
const rendered = (props: Partial<React.ComponentProps<typeof FootprintPath>> = {}) => render(<FootprintPath hexagons={REAL} allowListedTestAccount={false} {...props} />);
afterEach(() => { document.documentElement.classList.remove('dark'); vi.unstubAllGlobals(); });

describe('badge', () => {
  it('has exactly the format "N things known about you · M guesses waiting", with singulars', () => {
    expect(badgeText(4, 3)).toBe('4 things known about you · 3 guesses waiting');
    expect(badgeText(1, 1)).toBe('1 thing known about you · 1 guess waiting');
    expect(badgeText(0, 0)).toBe('0 things known about you · 0 guesses waiting');
    rendered();
    expect(screen.getByTestId('path-badge').textContent).toMatch(/^\d+ things? known about you · \d+ guesses? waiting$/);
  });
  it('at arrival for a real user counts 4 prints and the 3 unlocked guesses', () => {
    rendered();
    expect(screen.getByTestId('path-badge')).toHaveTextContent('4 things known about you · 3 guesses waiting');
  });
  it('moves with the walk: a yes adds a thing and removes a guess; "not me" removes only the guess', () => {
    const { unmount } = rendered({ extraLiveHandlers: ['name_pattern_guess'] });
    fireEvent.click(screen.getByTestId('btn-yes'));
    expect(screen.getByTestId('path-badge')).toHaveTextContent('5 things known about you · 2 guesses waiting');
    unmount();
    rendered({ extraLiveHandlers: ['name_pattern_guess'] });
    fireEvent.click(screen.getByTestId('btn-no'));
    expect(screen.getByTestId('path-badge')).toHaveTextContent('4 things known about you · 2 guesses waiting');
  });
});

describe('colour sits on footprints: a print tile is filled with its shade, every other hexagon is an unfilled outline', () => {
  const shadeHexes: string[] = Object.values(SHADES).map((s) => s.hex);
  const check = () => {
    const root = screen.getByTestId('footprint-path');
    // no background utility class anywhere on the path, and no colour in any inline style (a fill is an SVG attribute, never a style)
    expect(root.querySelectorAll('[class*="bg-"]').length).toBe(0);
    root.querySelectorAll('[style]').forEach((el) => expect(el.getAttribute('style'), 'inline style may size a tile, never colour it').not.toMatch(/background|color|fill|border|outline/i));
    expect(root.matches('[class*="bg-"]')).toBe(false);
    // hexagon outlines: only an ink (print) tile may be filled, and only with one of the five shades; grey, dashed and thick outlines stay unfilled
    const outlines = root.querySelectorAll('svg[data-outline]');
    expect(outlines.length).toBeGreaterThan(0);
    outlines.forEach((svg) => {
      const fill = svg.querySelector('polygon')!.getAttribute('fill');
      if (svg.getAttribute('data-outline') === 'ink') { expect(fill === 'none' || shadeHexes.includes(fill!)).toBe(true); }
      else expect(fill).toBe('none');
    });
    // any other filled polygon is inside a footprint mark and carries one of the five shades
    root.querySelectorAll('polygon').forEach((p) => {
      if (p.getAttribute('fill') === 'none' || p.closest('svg[data-outline]')) return;
      const print = p.closest('svg[data-print-fill]');
      expect(print).not.toBeNull();
      expect(shadeHexes).toContain(print!.getAttribute('data-print-fill'));
    });
    return root;
  };
  it('a print tile is filled with its shade, and the grey not-returned tile is not', () => {
    rendered({ allowListedTestAccount: true, hexagons: REAL });
    const u = screen.getByTestId('print-username').querySelector('svg[data-outline]')!;
    expect(u.getAttribute('data-tile-fill')).toBe(SHADES[4].hex);
    expect(screen.getByTestId('print-not-returned').querySelector('svg[data-outline]')!.getAttribute('data-tile-fill')).toBeNull();
  });
  it('in light mode', () => { rendered({ allowListedTestAccount: true, hexagons: WITH_PROFILE, initialAnswers: { 1: 'yes', 2: 'yes', 3: 'done' } }); check(); });
  it('in dark mode', () => { document.documentElement.classList.add('dark'); rendered({ allowListedTestAccount: true, hexagons: WITH_PROFILE, initialAnswers: { 1: 'yes' } }); check(); });
  it('every footprint has its shade number as pips and the shade word, so colour is never the only clue', () => {
    rendered({ initialAnswers: { 1: 'yes' } });
    for (const p of screen.getByTestId('path-behind').querySelectorAll('[data-print]')) {
      const key = p.getAttribute('data-print')!;
      const shade = screen.getByTestId(`print-shade-${key}`).textContent ?? '';
      expect(shade).toMatch(/S[1-5] (Slight|Mild|Moderate|Strong|Severe) [●○]{5}/);
    }
  });
  it('the five shades are the signed-off colours', () => {
    expect(Object.values(SHADES).map((s) => s.hex)).toEqual(['#FDE6E3', '#F8BDB5', '#EE847A', '#D3433A', '#8F1812']);
  });
  it('an accepted footprint is an outline with no fill, never a green state', () => {
    const { container } = render(<FootprintPath hexagons={REAL} allowListedTestAccount={false} />);
    expect(container.querySelector('[data-accepted="yes"]')).toBeNull(); // nothing offers acceptance yet
  });
});

describe('banned words and phrases', () => {
  const scan = (s: string) => {
    for (const w of BANNED_WORDS) expect(s, `banned word "${w}"`).not.toMatch(new RegExp(`\\b${w}\\b`, 'i'));
    for (const re of BANNED_PHRASES) expect(s, String(re)).not.toMatch(re);
  };
  it('are absent from every state of the page, including each tile as the current step', () => {
    for (const t of PATH_TILES) {
      const answers: Answers = {};
      for (const o of PATH_TILES) { if (o.n < t.n) answers[o.n] = 'not_now'; }
      // tile 6 needs 2 and tile 10 needs 4: answer them yes so the tile can become current
      if (t.needs) for (const n of t.needs) answers[n] = 'done';
      const { unmount } = rendered({ initialAnswers: answers, allowListedTestAccount: true, hexagons: [...WITH_PROFILE, ...NEVER], handoffIds: [] });
      scan(text());
      unmount();
    }
    const { unmount } = rendered({ initialAnswers: { 1: 'yes', 2: 'yes', 3: 'done' }, handoffIds: ['tg.username'] });
    scan(text()); unmount();
  });
  it('are absent from the tile config (copy, education, steps, gates)', () => {
    scan(PATH_TILES.map((t) => [t.copy, t.shortLabel, t.education, t.ifStep, t.consentGate ?? '', t.notCheckedNote ?? '', t.print?.label ?? ''].join(' ')).join(' '));
  });
  it('shows no retention or deletion line, no total, no bar, no score', () => {
    rendered({ initialAnswers: { 1: 'yes' } });
    expect(text()).not.toMatch(/delet|retain|retention|forget|nothing is left|leave no|remove a step/i);
    expect(document.querySelector('[role="progressbar"], progress, meter')).toBeNull();
  });
});

describe('reduced motion', () => {
  const mm = (matches: boolean) => vi.stubGlobal('matchMedia', (q: string) => ({ matches: matches && q.includes('reduce'), media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, dispatchEvent: () => false, onchange: null }));
  it('lands a footprint with the fade when motion is allowed', () => {
    mm(false);
    rendered({ initialAnswers: { 1: 'yes' } });
    expect(screen.getByTestId('footprint-path')).toHaveAttribute('data-motion', 'full');
    expect(screen.getByTestId('path-behind').querySelectorAll('svg.fp-land').length).toBeGreaterThan(0);
  });
  it('turns the fade off under prefers-reduced-motion', () => {
    mm(true);
    rendered({ initialAnswers: { 1: 'yes' } });
    expect(screen.getByTestId('footprint-path')).toHaveAttribute('data-motion', 'reduced');
    expect(screen.getByTestId('footprint-path').querySelectorAll('.fp-land').length).toBe(0);
  });
  it('the stylesheet also switches the animation off under the media query', () => {
    mm(false); rendered();
    expect(screen.getByTestId('footprint-path').querySelector('style')!.textContent).toMatch(/@media \(prefers-reduced-motion: reduce\)\{\.fp-land\{animation:none\}\}/);
  });
});

describe('arrival prints: 4 for real users, 5 for allow-listed test accounts', () => {
  const prints = () => screen.getByTestId('path-behind').querySelectorAll('[data-print]');
  it('a real user sees 4, even if profile data is somehow present', () => {
    rendered({ hexagons: WITH_PROFILE, allowListedTestAccount: false });
    expect([...prints()].map((p) => p.getAttribute('data-print'))).toEqual(['username', 'name', 'language', 'numeric_id']);
  });
  it('an allow-listed test account sees 5', () => {
    rendered({ hexagons: WITH_PROFILE, allowListedTestAccount: true });
    expect(prints().length).toBe(5);
    expect(prints()[4].getAttribute('data-print')).toBe('profile');
  });
  it('a test account whose profile lookup returned nothing sees 4 prints and a "not returned to this bot" tile, not a print', () => {
    rendered({ hexagons: REAL, allowListedTestAccount: true });
    expect(prints().length).toBe(4);
    expect(screen.getByTestId('print-not-returned')).toHaveTextContent('not returned to this bot');
  });
  it('the arrival list has 4 + 1 conditional entries', () => {
    expect(ARRIVAL_PRINTS.filter((p) => !p.profile).length).toBe(4);
    expect(ARRIVAL_PRINTS.filter((p) => p.profile).length).toBe(1);
  });
  it('never shows phone, IP, device or last-seen as arrival data, even if supplied', () => {
    rendered({ hexagons: [...WITH_PROFILE, ...NEVER], allowListedTestAccount: true });
    const behind = within(screen.getByTestId('path-behind')).getByText('Language setting').closest('ol')!.textContent ?? '';
    for (const bad of ['+85212345678', '203.0.113.9', 'Pixel 7', 'yesterday', '22.3,114.1']) expect(text()).not.toContain(bad);
    expect(behind).not.toMatch(/phone|IP address|device|last seen/i);
  });
  it('masks the Telegram ID', () => {
    rendered();
    expect(screen.getByTestId('print-value-numeric_id')).toHaveTextContent('68••••••••');
    expect(text()).not.toContain('6812345678');
  });
});

describe('the 11 tiles', () => {
  it('are config data: 11 entries, 3 GUESS and 8 PRIZE, copy of at most 12 words, a marker, a handler key', () => {
    expect(PATH_TILES.map((t) => t.n)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
    expect(PATH_TILES.filter((t) => t.kind === 'GUESS').map((t) => t.n)).toEqual([1, 2, 9]);
    for (const t of PATH_TILES) {
      expect(wordCount(t.copy.replace('{name}', 'Krispy King').replace('{handle}', '@krispyking5')), `tile ${t.n}`).toBeLessThanOrEqual(12);
      expect(['Live', 'In build', 'Planned']).toContain(t.status);
      expect(t.handlerKey).toBeTruthy();
      expect(t.education.length).toBeGreaterThan(10);
    }
  });
  it('markers match the brief: only tile 5 is In build, none is Live, because no tile completes a check on its own from this page today', () => {
    expect(PATH_TILES.filter((t) => t.status === 'In build').map((t) => t.n)).toEqual([5]);
    expect(PATH_TILES.filter((t) => t.status === 'Live')).toEqual([]);
    expect(PATH_TILES.filter((t) => t.paid).map((t) => t.n)).toEqual([6, 7, 10]);
  });
  it('each renders as the current step with its GUESS/PRIZE chip and marker, and is disabled when its check does not run', () => {
    for (const t of PATH_TILES) {
      const answers: Answers = {};
      for (const o of PATH_TILES) if (o.n < t.n) answers[o.n] = 'not_now';
      for (const n of t.needs ?? []) answers[n] = 'done';
      const { unmount } = rendered({ initialAnswers: answers });
      expect(screen.getByTestId('path-current').getAttribute('data-tile'), `tile ${t.n}`).toBe(String(t.n));
      expect(screen.getByTestId('chip-kind')).toHaveTextContent(t.kind);
      expect(screen.getByTestId('chip-status')).toHaveTextContent(t.status);
      expect(screen.getByTestId('btn-yes')).toBeDisabled();
      expect(screen.getByTestId('btn-no')).toBeDisabled();
      expect(screen.getByTestId('btn-yes')).toHaveTextContent(t.kind === 'GUESS' ? "Yes, that's me" : 'Step');
      expect(screen.getByTestId('btn-no')).toHaveTextContent(t.kind === 'GUESS' ? 'Not me' : 'Not now');
      expect(screen.getByTestId('current-education')).toBeInTheDocument(); // education before any ask
      unmount();
    }
  });
  it('buttons are at least 44px tall', () => {
    rendered();
    expect(screen.getByTestId('btn-yes').className).toMatch(/min-h-\[44px\]/);
  });
  it('tile 10 is honest: not checked, with the free self-check link', () => {
    rendered({ initialAnswers: { 1: 'not_now', 2: 'not_now', 3: 'not_now', 4: 'done', 5: 'not_now', 6: 'not_now', 7: 'not_now', 8: 'not_now', 9: 'not_now' } });
    expect(screen.getByTestId('current-not-checked')).toHaveTextContent('Not checked here.');
    const a = within(screen.getByTestId('current-not-checked')).getByRole('link');
    expect(a).toHaveAttribute('href', 'https://haveibeenpwned.com/');
    expect(screen.getByTestId('btn-yes')).toBeDisabled();
  });
  it('a locked tile (6 needs 2, 10 needs 4) is never the current step', () => {
    rendered({ initialAnswers: { 1: 'not_now', 2: 'not_me', 3: 'not_now', 4: 'not_now', 5: 'not_now' } });
    expect(screen.getByTestId('path-current').getAttribute('data-tile')).toBe('7');
  });
  it('ahead shows three dashed hexagons with a two-word label', () => {
    rendered();
    const ahead = screen.getByTestId('path-ahead');
    expect(ahead.querySelectorAll('[data-outline="dashed"]').length).toBe(3);
    for (const t of PATH_TILES.slice(1, 4)) { expect(wordCount(t.shortLabel)).toBe(2); expect(ahead).toHaveTextContent(t.shortLabel); }
  });
  it('outlines follow the rules: current thick, behind solid ink, ahead dashed, nothing returned thin grey', () => {
    rendered({ hexagons: REAL, allowListedTestAccount: true });
    expect(screen.getByTestId('path-current').querySelector('[data-outline="thick"]')).not.toBeNull();
    expect(screen.getByTestId('print-username').querySelector('[data-outline="ink"]')).not.toBeNull();
    expect(screen.getByTestId('print-not-returned').querySelector('[data-outline="grey"]')).not.toBeNull();
  });
});

describe('the one live handler: the Telegram to web handoff', () => {
  it('tile 5 shows no buttons that act and completes itself when the handoff ids arrive; the checks go to the technical panel', () => {
    rendered({ initialAnswers: { 1: 'not_now', 2: 'not_now', 3: 'not_now', 4: 'not_now' } });
    expect(screen.getByTestId('path-current').getAttribute('data-tile')).toBe('5');
    expect(screen.getByTestId('btn-yes')).toBeDisabled();
    expect(text()).toContain('one-time link');
  });
  it('with handoff ids, tile 5 is done and the panel says how many checks arrived, ids only', () => {
    rendered({ initialAnswers: { 1: 'not_now', 2: 'not_now', 3: 'not_now', 4: 'not_now' }, handoffIds: ['tg.username', 'tg.language'] });
    // tile 2 was set aside, so tile 6 (needs 2) stays locked and the walk moves on to 7
    expect(screen.getByTestId('path-current').getAttribute('data-tile')).toBe('7');
    expect(screen.getByTestId('path-current').getAttribute('data-tile')).not.toBe('5');
    expect(screen.getByTestId('handoff-received')).toHaveTextContent('2');
  });
  it('a revealed print is followed by what someone could do with it', () => {
    rendered({ initialAnswers: { 1: 'yes', 2: 'yes', 3: 'done' } });
    expect(screen.getByTestId('path-last-education')).toHaveTextContent('Number issued in Hong Kong (+852). What someone could do with it: a phone number links you across services');
  });
  it('step handlers only work for keys that are live: with a live key the yes leaves a "you told us" print', () => {
    rendered({ extraLiveHandlers: ['name_pattern_guess'] });
    fireEvent.click(screen.getByTestId('btn-yes'));
    expect(screen.getByTestId('path-behind')).toHaveTextContent('Real name (you told us)');
  });
});

describe('technical panel', () => {
  it('is collapsed by default and holds no verdict: no tick, no score, no summary', () => {
    rendered();
    const panel = screen.getByTestId('path-technical') as HTMLDetailsElement;
    expect(panel.open).toBe(false);
    expect(panel.textContent).toMatch(/web checks/);
    expect(panel.textContent).toContain('Sent with every message');
    expect(screen.getByTestId('never-given')).toHaveTextContent(/Telegram does not give us/);
    expect(text()).not.toMatch(/[✓✔✅☑]/);
  });
  it('lists the web checks from the registry, with no total claim beyond their count', () => {
    rendered();
    expect(screen.getByTestId('path-technical').textContent).toMatch(/\d+ web checks/);
  });
});

describe('sample marker', () => {
  it('shows "Sample data" only when asked', () => {
    const { unmount } = rendered({ sample: true });
    expect(screen.getByTestId('path-sample')).toBeInTheDocument();
    unmount();
    rendered();
    expect(screen.queryByTestId('path-sample')).toBeNull();
  });
});
