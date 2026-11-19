// Per-post social cards (MPT Social Content System v1, phase 2; spec https://app.notion.com/p/41d28547eaa7819eb209c957ca2850d2 section 5).
// One card per post and platform, built from that day's image headline. Brand rules applied here:
//   white background, Matrix Green #27AE60 accent, Inter Bold/Black headline, approved logo v1.0 bottom-left with clear space,
//   Alice only as one of the approved expression plates (assets/branding/alice-mpc-7795), never generated or redrawn,
//   headline readable at phone thumbnail size, key text inside the central safe area, no claims beyond the approved list.
// satori lays the card out as SVG (text becomes paths, so no system fonts are needed) and sharp rasterises it.

import satori from 'satori';
import sharp from 'sharp';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const repo = join(here, '..', '..');
const font = (w) => readFileSync(join(here, 'node_modules', '@fontsource', 'inter', 'files', `inter-latin-${w}-normal.woff`));

export const GREEN = '#27AE60';
const INK = '#111827';
const MUTED = '#4B5563';
const PALE = '#E9F7EF';

// Card sizes per platform (spec section 4). Facebook reuses the Instagram 4:5 card. LinkedIn is 1200x630 so Make's og preset
// (1200x630, fit=pad) shows it without bands.
export const SIZES = {
  instagram: [1080, 1350],
  linkedin: [1200, 630],
  x: [1600, 900],
  pinterest: [1000, 1500],
};
export const PLATFORM_CARD = { instagram: 'instagram', facebook: 'instagram', linkedin: 'linkedin', x: 'x', pinterest: 'pinterest' };

// Templates (spec section 5): label shown on the card, and the Alice plates that fit its mood.
export const TEMPLATES = {
  fix: { label: 'ONE FIX', alice: ['pointing', 'explaining', 'determined', 'presenting'] },
  myth: { label: 'MYTH VS FACT', alice: ['bemused', 'reflective', 'curious2'] },
  know: { label: 'DID YOU KNOW', alice: ['curious', 'explaining', 'alert', 'neutral'] },
};
const PREFIXES = [
  [/^one fix\s*:\s*/i, 'fix'],
  [/^myth( vs\.? fact)?\s*:\s*/i, 'myth'],
  [/^did you know\s*:\s*/i, 'know'],
];
const PILLAR_TEMPLATE = { fix: 'fix', myth: 'myth' };

const clean = (s) => s.replace(/\*\*/g, '').replace(/^thread:\s*/i, '').replace(/\s*\([^)]*\)\s*$/, '').replace(/^["“”']+|["“”']+$/g, '').trim();
const hash = (s) => [...s].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7);

/**
 * The card for one day. `imageLine` is the IMAGE HEADLINES item ("One fix: Remove yourself from Spokeo"); without one the card
 * falls back to the day's topic and the pillar tag in its trailing "(...)".
 */
export function cardSpec(date, { imageLine = null, topic = '' } = {}) {
  let template = null;
  let headline = imageLine ? imageLine.trim() : '';
  for (const [re, t] of PREFIXES) if (re.test(headline)) { template = t; headline = headline.replace(re, ''); break; }
  if (!headline) {
    const pillar = /\(([^)]*)\)\s*$/.exec(topic)?.[1]?.toLowerCase().trim();
    template = PILLAR_TEMPLATE[pillar] ?? 'know';
    headline = clean(topic);
  }
  template ??= 'know';
  headline = clean(headline);
  if (!headline) throw new Error(`${date}: no headline for the card`);
  const poses = TEMPLATES[template].alice;
  return { date, template, label: TEMPLATES[template].label, headline, alice: poses[hash(date) % poses.length], fallback: !imageLine };
}

const pngCache = new Map();
async function asset(key, make) {
  if (!pngCache.has(key)) pngCache.set(key, `data:image/png;base64,${(await make()).toString('base64')}`);
  return pngCache.get(key);
}
// Alice plates are 2560x1440 ink on white; trim to the figure so she can be placed and sized.
// The ink becomes the alpha channel (white paper turns transparent) so she sits on the colour panel; the drawing itself is unchanged.
async function aliceInk(pose) {
  const grey = await sharp(join(repo, 'assets/branding/alice-mpc-7795', `alice-${pose}-2560x1440.png`)).trim({ threshold: 20 }).resize({ height: 1100 }).greyscale().raw().toBuffer({ resolveWithObject: true });
  const { width, height } = grey.info;
  const rgba = Buffer.alloc(width * height * 4);
  for (let i = 0; i < width * height; i++) { rgba[i * 4] = 17; rgba[i * 4 + 1] = 24; rgba[i * 4 + 2] = 39; rgba[i * 4 + 3] = 255 - grey.data[i]; }
  return sharp(rgba, { raw: { width, height, channels: 4 } }).png().toBuffer();
}
const alicePng = (pose) => asset(`alice:${pose}`, () => aliceInk(pose));
const logoPng = () => asset('logo', () => sharp(join(repo, 'assets/branding/logo/mpt-logo-primary-black_v1.0.svg'), { density: 300 }).resize({ width: 900 }).png().toBuffer());
const aliceRatio = new Map();
async function aliceAspect(pose) {
  if (!aliceRatio.has(pose)) {
    const m = await sharp(Buffer.from((await alicePng(pose)).split(',')[1], 'base64')).metadata();
    aliceRatio.set(pose, m.width / m.height);
  }
  return aliceRatio.get(pose);
}

const h = (type, style, children) => ({ type, props: { style, children } });
const img = (src, style) => ({ type: 'img', props: { src, style } });

// Headline size: as large as fits in about four lines of the text column.
function headlineSize(text, colWidth, height) {
  const chars = text.length;
  const byWidth = (colWidth * 2.1) / Math.max(10, Math.sqrt(chars * 9));
  return Math.round(Math.min(byWidth, height * 0.11, colWidth * 0.14));
}

export async function cardSvg(spec, platform) {
  const [W, H] = SIZES[PLATFORM_CARD[platform] ?? platform];
  const portrait = H > W;
  const pad = Math.round(Math.min(W, H) * 0.075);
  const logoW = Math.round(Math.min(W, H) * (portrait ? 0.36 : 0.34));
  const ratio = await aliceAspect(spec.alice);
  const labelFs = Math.round(Math.max(18, Math.min(W, H) * 0.034));
  let aliceH = Math.round(portrait ? H * 0.52 : H * 0.94);
  let aliceW = Math.round(aliceH * ratio);
  const textW = portrait ? W - pad * 2 : W - pad * 2 - Math.min(aliceW, W * 0.38);
  const fs = Math.min(headlineSize(spec.headline, textW, H), portrait ? Math.round(H * 0.072) : Infinity);
  const cta = 'Check your exposure: myprivacytool.io/scan';
  const ctaFs = Math.round(Math.max(16, Math.min(W, H) * 0.028));
  const accent = Math.round(Math.min(W, H) * 0.022);
  // Portrait cards keep a footer band for the logo and link; Alice and her panel sit above it so nothing overlaps.
  const footerH = portrait ? Math.round(logoW * 428 / 1541 + ctaFs * 1.5 + pad * 1.4) : 0;
  if (portrait) {
    // Estimated bottom of the headline block (Inter Black averages about 0.56 em per character); Alice fits below it.
    const lines = Math.ceil((spec.headline.length + 2) * fs * 0.56 / (textW - accent));
    const textBottom = pad * 1.1 + labelFs * 2 + labelFs * 1.1 + lines * fs * 1.08 + fs * 0.6;
    aliceH = Math.round(Math.max(H * 0.36, Math.min(aliceH, H - footerH - textBottom - pad * 0.2)));
    aliceW = Math.round(aliceH * ratio);
  }

  const label = h('div', { display: 'flex', alignSelf: 'flex-start', background: spec.template === 'myth' ? INK : GREEN, color: '#fff', fontSize: labelFs, fontWeight: 800, letterSpacing: labelFs * 0.12, padding: `${labelFs * 0.45}px ${labelFs * 0.8}px`, borderRadius: labelFs * 0.35 }, spec.label);
  const words = (spec.template === 'myth' ? `“${spec.headline}”` : spec.headline).split(/\s+/);
  // One flex child per word, so a line only breaks at a space (never inside "tune-up").
  const headline = h('div', { display: 'flex', flexWrap: 'wrap', fontSize: fs, fontWeight: 900, color: INK, lineHeight: 1.08, letterSpacing: -fs * 0.02, marginTop: labelFs * 1.1, maxWidth: textW - accent }, words.map((w, i) => h('span', { marginRight: i < words.length - 1 ? fs * 0.26 : 0 }, w)));
  const rule = h('div', { display: 'flex', width: fs * 1.6, height: Math.max(6, fs * 0.09), background: GREEN, marginTop: fs * 0.45, borderRadius: 4 }, '');
  const footer = h('div', { display: 'flex', flexDirection: 'column', alignItems: 'flex-start', position: 'absolute', left: pad + accent, bottom: pad * (portrait ? 0.7 : 0.9) }, [
    img(await logoPng(), { width: logoW, height: Math.round(logoW * 428 / 1541) }),
    h('div', { display: 'flex', fontSize: ctaFs, fontWeight: 700, color: GREEN, marginTop: ctaFs * 0.5 }, cta),
  ]);
  const aliceRight = portrait ? -aliceW * 0.1 : pad * 0.3;
  const alice = img(await alicePng(spec.alice), {
    position: 'absolute', height: aliceH, width: aliceW,
    right: aliceRight, bottom: footerH,
  });
  // Pale green panel behind Alice gives each card a strong colour block without a busy background.
  // Pale green disc behind Alice gives each card a strong colour block without a busy background.
  const disc = Math.round(aliceH * (portrait ? 1.0 : 0.95));
  const panel = h('div', { display: 'flex', position: 'absolute', background: PALE, borderRadius: disc / 2, width: disc, height: disc, right: aliceRight + aliceW / 2 - disc / 2, bottom: portrait ? footerH + aliceH * 0.06 : H * 0.02 }, '');
  const band = portrait ? h('div', { display: 'flex', position: 'absolute', left: 0, bottom: 0, width: W, height: footerH, background: '#ffffff', borderTop: `${Math.max(4, accent / 3)}px solid ${GREEN}` }, '') : null;

  const tree = h('div', { display: 'flex', position: 'relative', width: W, height: H, background: '#ffffff', fontFamily: 'Inter' }, [
    h('div', { display: 'flex', position: 'absolute', left: 0, top: 0, width: accent, height: H, background: GREEN }, ''),
    panel,
    alice,
    ...(band ? [band] : []),
    h('div', { display: 'flex', flexDirection: 'column', position: 'absolute', left: pad + accent, top: pad * (portrait ? 1.1 : 1.0), width: textW - accent }, [label, headline, rule]),
    footer,
  ]);
  return satori(tree, {
    width: W, height: H,
    fonts: [600, 800, 900].map((w) => ({ name: 'Inter', data: font(w), weight: w, style: 'normal' })),
  });
}

/** JPEG for every card size: {instagram: Buffer, linkedin: Buffer, x: Buffer, pinterest: Buffer}. */
export async function renderCards(spec) {
  const out = {};
  for (const size of Object.keys(SIZES)) {
    const svg = await cardSvg(spec, size);
    out[size] = await sharp(Buffer.from(svg)).flatten({ background: '#ffffff' }).jpeg({ quality: 90, mozjpeg: true }).toBuffer();
  }
  return out;
}
