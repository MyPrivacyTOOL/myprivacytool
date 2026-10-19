import { describe, it, expect } from 'vitest';
import { toTile, tileKind, TILE_COPY, riskProfile, riskProfileParts, tileAriaLabel, tileIcon, tileExplanation, withUserStatement, type TileKind } from './hexagonTile';
import { HEXAGONS } from '../../shared/hexagon-registry/registry.js';
import { captureStatus } from '../../shared/hexagon-registry/status.js';

// MPC-7916 Phase 1: one function decides what a tile says. These are the rows Chris agreed on MPC-7913.
describe('toTile (MPC-7916)', () => {
  const rows: [string, string, string, TileKind][] = [
    ['webrtc-leak says No Leak Detected: the code cannot tell this from a blocked check', 'webrtc-leak', 'No Leak Detected', 'couldnt_check'],
    ['webrtc-leak that is leaking needs fixing', 'webrtc-leak', 'Leaking: 203.0.113.9', 'needs_fixing'],
    ['canvas fingerprint (medium risk) needs fixing', 'canvas-fingerprint', 'Vale Tulip', 'needs_fixing'],
    ['dns-leak cannot be checked from a web page, whatever the detector said', 'dns-leak', 'No Leak Detected', 'cant_check_here'],
    ['dns-leak that claims a leak still cannot be checked from a web page', 'dns-leak', 'Leaking: 10.0.0.1', 'cant_check_here'],
    ['typing patterns with no input is not checked yet', 'typing-patterns', 'No input yet', 'not_checked'],
    ['location is an estimate, so it is our guess', 'location', 'Springfield, England', 'our_guess'],
    ['internet provider is an estimate, so it is our guess', 'isp', 'Example Broadband', 'our_guess'],
    ['a placeholder location is not a guess, we could not tell', 'location', 'Location Detected', 'couldnt_check'],
    ['primary language is measured and low risk', 'primary-language', 'English (UK)', 'seen_low_risk'],
    ['cookies that are empty are the registry-allowed clear', 'cookies-status', 'Empty', 'clear'],
    ['a failed read is could not check', 'battery', 'Check failed', 'couldnt_check'],
    ['the TLS version is never measured, so it is not a guess or a fact', 'tls-config', 'TLS 1.3 (likely)', 'couldnt_check'],
    ['an id that is not in the registry never claims anything', 'not-a-hexagon', 'anything', 'not_checked'],
  ];
  it.each(rows)('%s', (_name, id, value, kind) => {
    expect(tileKind({ id, value })).toBe(kind);
  });

  it('copy: green is solid and only for clear; purple is faint and only for a guess; grey shows no value when no claim is made', () => {
    for (const [kind, c] of Object.entries(TILE_COPY)) {
      if (c.colour === 'green' && kind !== 'you_told_us') expect(kind).toBe('clear');
      // Your word is never as strong as our check.
      if (kind === 'you_told_us') expect(c.level).toBe('medium');
      if (c.colour === 'purple') {
        expect(kind).toBe('our_guess');
        expect(c.level).toBe('faint');
      }
      if (c.colour === 'red') expect(c.level).toBe('solid');
    }
    for (const k of ['not_checked', 'couldnt_check', 'cant_check_here'] as TileKind[]) {
      expect(TILE_COPY[k].colour).toBe('grey');
      expect(TILE_COPY[k].showValue).toBe(false);
    }
  });

  it('no tile line, glyph or aria label ever contains a percentage', () => {
    for (const c of Object.values(TILE_COPY)) {
      expect(c.line).not.toMatch(/%/);
      expect(c.glyph).not.toMatch(/%/);
    }
    const t = toTile({ id: 'location', value: 'Springfield' });
    expect(tileAriaLabel('Location', 'Springfield', t)).not.toMatch(/%|confidence/i);
  });

  it('honesty: for every registry hexagon, a placeholder or failed value never becomes clear or needs fixing', () => {
    for (const h of HEXAGONS as { id: string }[]) {
      for (const value of ['No input yet', 'Check failed', 'Unknown', 'Collecting...', '']) {
        const k = tileKind({ id: h.id, value });
        expect(['not_checked', 'couldnt_check', 'cant_check_here']).toContain(k);
      }
    }
  });

  it('honesty: clear only where captureStatus says clear, and the 7 cannot-be-checked tiles are always grey', () => {
    for (const h of HEXAGONS as { id: string; truth: { level: string } }[]) {
      for (const value of ['Empty', 'None', 'Secure (HTTPS)', 'No Leak Detected', 'Something real']) {
        const k = tileKind({ id: h.id, value });
        if (k === 'clear') expect(captureStatus(h.id, value, {})).toBe('clear');
        if (h.truth.level === 'cannot_be_checked') expect(k).toBe('cant_check_here');
      }
    }
  });

  it('the context is passed on: an assumed WiFi default is not checked', () => {
    expect(tileKind({ id: 'connection', value: 'WiFi' }, { connectionIsMeasured: false })).not.toBe('our_guess');
  });
});

describe('risk profile (MPC-7916)', () => {
  it('counts the tiles in each group; unchecked kinds all count as not checked', () => {
    const p = riskProfile([
      { kind: 'clear' }, { kind: 'needs_fixing' }, { kind: 'needs_fixing' }, { kind: 'our_guess' },
      { kind: 'seen_low_risk' }, { kind: 'not_checked' }, { kind: 'couldnt_check' }, { kind: 'cant_check_here' },
    ]);
    expect(p).toEqual({ clear: 1, youToldUs: 0, confirmed: 0, needsFixing: 2, ourGuess: 1, seenLowRisk: 1, notChecked: 3 });
  });

  it('is plain counts: no percentage, no "of", no rating word', () => {
    const text = riskProfileParts(riskProfile([{ kind: 'needs_fixing' }, { kind: 'not_checked' }])).map((p) => p.text).join(' · ');
    expect(text).toBe('0 clear · 1 needs fixing · 0 our guess · 0 seen, minor · 1 not checked yet');
    expect(text).not.toMatch(/%| of |low risk rating|medium|high/i);
  });

  it('an empty scan is all zeros, never "clear"', () => {
    expect(riskProfile([])).toEqual({ clear: 0, youToldUs: 0, confirmed: 0, needsFixing: 0, ourGuess: 0, seenLowRisk: 0, notChecked: 0 });
  });
});

describe('tile icon (MPC-7916)', () => {
  it('a green-tick icon is kept only on a clear tile', () => {
    expect(tileIcon('cookies-status', '✅', 'clear')).toBe('✅');
    expect(tileIcon('dns-leak', '✅', 'cant_check_here')).toBe('🔓');
    expect(tileIcon('webrtc-leak', '✅', 'couldnt_check')).toBe('🌐');
  });
  it('any other icon is left alone', () => {
    expect(tileIcon('dns-leak', '🔓', 'cant_check_here')).toBe('🔓');
    expect(tileIcon('canvas-fingerprint', '🎨', 'needs_fixing')).toBe('🎨');
  });
});

describe('tile explanation (MPC-7916)', () => {
  it('a grey tile never says "looks normal": the words follow the tile, not the detector', () => {
    const tile = toTile({ id: 'dns-leak', value: 'No Leak Detected' });
    const said = tileExplanation('DNS Leak', 'No Leak Detected', tile, 'Your lookups look normal', 'We did not see your lookups leaving through an unexpected route.');
    expect(said.headline).toBe("DNS Leak: A web page can't check this");
    expect(`${said.headline} ${said.text}`).not.toMatch(/look normal|did not see|no leak|safe/i);
  });
  it('a guess says it is a guess, and a found tile keeps the detector text', () => {
    const guess = toTile({ id: 'location', value: 'Springfield' });
    expect(tileExplanation('Location', 'Springfield', guess, 'h', 'You are near Springfield.').text).toMatch(/^This is our guess, not a measurement\. You are near Springfield\./);
    const found = toTile({ id: 'canvas-fingerprint', value: 'Vale Tulip' });
    expect(tileExplanation('Canvas', 'Vale Tulip', found, 'Your browser gives you away', 'Details.')).toEqual({ headline: 'Your browser gives you away', text: 'Details.' });
  });
});

describe('you told us (MPC-7916 Phase 2)', () => {
  it('the visitor saying a tile is fixed makes it medium green, never solid, and counts as "you told us"', () => {
    const red = toTile({ id: 'canvas-fingerprint', value: 'Vale Tulip' });
    expect(red.kind).toBe('needs_fixing');
    const told = withUserStatement(red);
    expect(told).toMatchObject({ kind: 'you_told_us', colour: 'green', level: 'medium', line: 'You told us' });
    const p = riskProfile([told, red]);
    expect(p).toMatchObject({ youToldUs: 1, needsFixing: 1, clear: 0 });
    expect(riskProfileParts(p).map((x) => x.text)).toContain('1 you told us');
  });
  it('the profile line gains "you told us" only when there is one', () => {
    expect(riskProfileParts(riskProfile([])).map((x) => x.text).join(' ')).not.toMatch(/told us/);
  });
});

import { cannotCheckLast } from './hexagonTile';

describe('cannotCheckLast (from the first tile PR)', () => {
  it('moves cannot-check ids to the end, keeping the rest in order', () => {
    const ids = ['dns-leak', 'canvas-fingerprint', 'social-platforms', 'device', 'webrtc-leak'].map((id) => ({ id }));
    expect(cannotCheckLast(ids).map((i) => i.id)).toEqual(['canvas-fingerprint', 'device', 'webrtc-leak', 'dns-leak', 'social-platforms']);
  });
});

import { TILE_BROWSER_SAYS } from './hexagonTile';

describe('"Your browser says this" tick', () => {
  it('Timezone/Locale is seen, not a fault, and carries the tick', () => {
    const t = toTile({ id: 'timezone-locale', value: 'London (en-GB)' });
    expect(t.kind).toBe('seen_low_risk');
    expect(t.browserSays).toBe(true);
    expect(tileAriaLabel('Timezone/Locale', 'London (en-GB)', t)).toMatch(new RegExp(`${TILE_BROWSER_SAYS}\\.$`));
  });

  it('every measured tile held at confidence 100 gets the tick when it has a real reading; nothing else does', () => {
    // measured at 100: tick
    for (const [id, value] of [['browser', 'Chrome 141'], ['time', 'Sun, 02:14 PM'], ['orientation', 'Landscape'], ['webrtc-leak', 'Leaking: 203.0.113.7'], ['canvas-fingerprint', 'a3f9c21e....']] as const) {
      expect(toTile({ id, value }).browserSays).toBe(true);
    }
    // measured below 100, estimates, cannot-be-checked, and failed or placeholder readings: no tick
    expect(toTile({ id: 'device', value: 'Desktop (Windows 11)' }).browserSays).toBe(false); // confidence 92
    expect(toTile({ id: 'location', value: 'Springfield' }).browserSays).toBe(false); // estimate
    expect(toTile({ id: 'dns-leak', value: 'No Leak Detected' }).browserSays).toBe(false); // cannot be checked
    expect(toTile({ id: 'timezone-locale', value: 'Check failed' }).browserSays).toBe(false);
    expect(toTile({ id: 'browser', value: 'Unknown' }).browserSays).toBe(false);
  });

  it('WebRTC Leak still needs fixing even though the browser says it', () => {
    expect(toTile({ id: 'webrtc-leak', value: 'Leaking: 203.0.113.7' }).kind).toBe('needs_fixing');
  });
});

import { withGuessAnswer } from './hexagonTile';

describe('guess answers (prototype)', () => {
  const guess = () => toTile({ id: 'location', value: 'Springfield, Exampleshire' });
  it('a guess answered yes is the visitor\'s word; the device agreeing is its own kind; wrong hides the wrong value', () => {
    expect(guess().kind).toBe('our_guess');
    expect(withGuessAnswer(guess(), 'yes')).toMatchObject({ kind: 'you_confirmed', line: 'You said yes', showValue: true });
    expect(withGuessAnswer(guess(), 'device_agrees')).toMatchObject({ kind: 'device_agrees', line: 'Your device agrees', showValue: true });
    expect(withGuessAnswer(guess(), 'no')).toMatchObject({ kind: 'guess_wrong', line: 'Our guess was wrong', showValue: false });
    expect(withGuessAnswer(guess(), 'device_far')).toMatchObject({ kind: 'guess_wrong', showValue: false });
  });
  it('only a guess can be answered', () => {
    const measured = toTile({ id: 'browser', value: 'Chrome 141' });
    expect(withGuessAnswer(measured, 'yes')).toBe(measured);
  });
  it('confirmed guesses are counted as "confirmed", and only shown when there are some', () => {
    const p = riskProfile([withGuessAnswer(guess(), 'yes'), withGuessAnswer(guess(), 'device_agrees'), guess()]);
    expect(p).toMatchObject({ confirmed: 2, ourGuess: 1 });
    expect(riskProfileParts(p).map((x) => x.text)).toContain('2 confirmed');
    expect(riskProfileParts(riskProfile([guess()])).map((x) => x.text).join(' ')).not.toMatch(/confirmed/);
  });
  it('the explanation says whose word it is, and why a wrong guess is not a fact', () => {
    const yes = tileExplanation('Location', 'Springfield', withGuessAnswer(guess(), 'yes'), undefined, 'Shows ...');
    expect(yes.text).toMatch(/your word, not our proof/);
    const wrong = tileExplanation('Location', 'Springfield', withGuessAnswer(guess(), 'no'));
    expect(wrong.headline).toBe('Location: Our guess was wrong');
    expect(wrong.text).toMatch(/not a fact/);
  });
});
