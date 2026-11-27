// curtain-core.js: the one definition of the MyPrivacyTOOL curtain (white, line-drawn folds, black ink).
//
// A pure function of progress: curtainSvg(t, opts) returns an SVG string for t in [0, 1]
// (0 = closed, 1 = fully open and gathered at the sides). No DOM, no clock, no randomness
// other than a fixed seed, so the website, the video renderer and the newsletter GIF all
// draw exactly the same folds at the same moment. That is the brand rule in
// assets/alice/spec/animation-production.md section 4a: same folds, same motion speed, every time.
//
// Used by: curtain-element.js (web component), tools/curtain/render.mjs (video, GIF, PNG sequence).

export const BRAND = Object.freeze({
  ink: '#000000',      // black ink
  paper: '#ffffff',    // white paper
  seed: 7,             // fixed: changes the folds, so change it only on purpose
  durationMs: 1200,    // spec: reveal takes 0.5 to 1.5 s
  gatherPct: 7,        // each panel bunches to this % of the width when open
  foldsPerHundredPx: 1.55,
});

export function clamp01(t) { return t < 0 ? 0 : t > 1 ? 1 : t; }

// Eased, never jerky: slow start, fast middle, soft landing.
export function ease(t) {
  t = clamp01(t);
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let r = Math.imul(a ^ (a >>> 15), 1 | a);
    r = (r + Math.imul(r ^ (r >>> 7), 61 | r)) ^ r;
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}
const f2 = (n) => (Math.round(n * 100) / 100).toString();

export function resolve(opts = {}) {
  const o = { ...BRAND, width: 1000, height: 600, ...opts };
  o.width = Math.max(40, +o.width); o.height = Math.max(40, +o.height);
  o.rodH = Math.max(6, Math.round(o.height * 0.022));
  o.folds = o.folds ? Math.round(o.folds) : Math.max(4, Math.min(16, Math.round((o.width / 2 / 100) * o.foldsPerHundredPx)));
  // Line weight and fold spacing scale with the SMALLER of width and height, so a short wide strip
  // (a page header) is not drawn as heavily as a full frame. 1000x450 or larger draws at scale 1 or more.
  o.k = Math.max(0.5, Math.min(o.width / 1000, o.height / 450));
  o.line = Math.max(0.8, o.k * 1.5);   // base stroke width in px
  return o;
}

// Panel widths at progress t. Exposed so tests and layouts can ask "how much is open?"
export function geometry(t, opts) {
  const o = resolve(opts), e = ease(t);
  const half = o.width / 2, gathered = o.width * o.gatherPct / 100;
  const w = half + (gathered - half) * e;
  return { e, panelW: w, openFraction: 1 - (2 * w) / o.width };
}

// One panel in local coordinates: x = 0 is the outer (fixed) edge, x grows toward the centre.
function panel(side, t, o) {
  const { e, panelW: w } = geometry(t, o);
  const rand = mulberry32(o.seed + (side === 'left' ? 0 : 101));
  const H = o.height, top = o.rodH, hemBase = H - 3;
  const swayAmp = o.width * (0.0025 + 0.013 * e);        // folds get wavier as the cloth bunches
  const hem = (x) => hemBase - 5 * Math.sin(Math.PI * x / Math.max(w, 1)) * (1 - 0.5 * e)
                     - 7 * e * Math.sin((x / Math.max(w, 1)) * 6.2 + t * 5);   // hem lifts and ripples
  const parts = [];

  // cloth: white, outlined
  const edge = [];
  for (let i = 0; i <= 24; i++) {
    const y = top + (hem(w) - top) * (i / 24);
    edge.push([w + Math.sin(i * 0.9 + (side === 'left' ? 0.3 : 2.1)) * (1 + 3 * e), y]);   // cut edge wobbles
  }
  const hemPts = [];
  for (let i = 24; i >= 0; i--) { const x = w * (i / 24); hemPts.push([x, hem(x)]); }
  const outline = [[0, top], [w, top], ...edge, ...hemPts].map((p) => f2(p[0]) + ',' + f2(p[1])).join(' ');
  parts.push(`<polygon points="${outline}" fill="${o.paper}" stroke="${o.ink}" stroke-width="${f2(o.line)}" stroke-linejoin="round"/>`);

  // folds: clusters of fine vertical lines, heavier on the shaded side (engraving look)
  const folds = o.folds;
  for (let k = 0; k < folds; k++) {
    const u = (k + 0.5 + (rand() - 0.5) * 0.5) / folds;           // jittered, sorted fold position 0..1
    const x0 = u * w, phase = rand() * 6.28, cycles = 0.7 + rand() * 0.9;
    const lines = 6 + Math.floor(rand() * 4);
    for (let j = 0; j < lines; j++) {
      // lines pack tightly on the shaded (right) side of a fold and thin out on the lit side
      const side = j === 0 ? 0 : 1.2 + (j / lines) * 11;
      const dx = (side + (rand() - 0.5) * 0.7) * (0.55 + 0.45 * (w / (o.width / 2))) * o.k;
      const len = 0.35 + rand() * 0.65, fromTop = rand() < 0.62;
      const y1 = fromTop ? top : top + (hem(x0) - top) * (1 - len);
      const y2 = fromTop ? top + (hem(x0) - top) * len : hem(x0);
      const pts = [];
      const n = 18;
      for (let i = 0; i <= n; i++) {
        const y = y1 + (y2 - y1) * (i / n);
        const x = x0 + dx + swayAmp * Math.sin((y / H) * cycles * 6.28 + phase) * (j === 0 ? 1 : 0.8);
        pts.push(f2(Math.max(0.5, Math.min(w - 0.5, x))) + ',' + f2(y));
      }
      const sw = o.line * (j === 0 ? 1.7 : 0.45 + rand() * 0.4);
      parts.push(`<polyline points="${pts.join(' ')}" fill="none" stroke="${o.ink}" stroke-width="${f2(sw)}" stroke-linecap="round" stroke-opacity="${f2(j === 0 ? 1 : 0.6 + rand() * 0.4)}"/>`);
    }
  }
  // rod rings at each fold head
  for (let k = 0; k < folds; k++) {
    const x = ((k + 0.5) / folds) * w;
    parts.push(`<ellipse cx="${f2(x)}" cy="${f2(top)}" rx="${f2(o.line * 2.2)}" ry="${f2(o.rodH * 0.75)}" fill="${o.paper}" stroke="${o.ink}" stroke-width="${f2(o.line)}"/>`);
  }
  const tx = side === 'left' ? '' : ` transform="translate(${f2(o.width)},0) scale(-1,1)"`;
  return `<g data-side="${side}"${tx}>${parts.join('')}</g>`;
}

export function curtainSvg(t, opts = {}) {
  const o = resolve(opts);
  const rod = `<rect x="0" y="0" width="${o.width}" height="${o.rodH}" fill="${o.ink}"/>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${o.width} ${o.height}" width="${o.width}" height="${o.height}" role="img" aria-label="Curtain">${panel('left', t, o)}${panel('right', t, o)}${rod}</svg>`;
}
