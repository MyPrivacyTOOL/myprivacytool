// jsPDF cannot read CSS variables, so resolve the MPC-6906 theme tokens in
// src/index.css to RGB at export time. Nothing here hard-codes a colour: change
// the token and the PDF follows.

export type RGB = [number, number, number];

const hslToRgb = (h: number, s: number, l: number): RGB => {
  s /= 100;
  l /= 100;
  const k = (n: number) => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  return [Math.round(f(0) * 255), Math.round(f(8) * 255), Math.round(f(4) * 255)];
};

/** Resolve a token such as `--brand-ink` ("145 100% 22%") to an RGB triplet. */
export const tokenRgb = (name: string): RGB => {
  const raw = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  const m = raw.match(/^(-?[\d.]+)\s+([\d.]+)%\s+([\d.]+)%/);
  if (!m) throw new Error(`Theme token ${name} is not an HSL triplet: "${raw}"`);
  return hslToRgb(Number(m[1]), Number(m[2]), Number(m[3]));
};

export const getPdfTheme = () => ({
  page: tokenRgb('--background'),
  ink: tokenRgb('--foreground'),
  muted: tokenRgb('--muted-foreground'),
  panel: tokenRgb('--card'),
  panelAlt: tokenRgb('--muted'),
  border: tokenRgb('--surface-border'),
  brand: tokenRgb('--brand-ink'),
  brandSoft: tokenRgb('--brand-soft'),
  onBrand: tokenRgb('--primary-foreground'),
  low: tokenRgb('--risk-low'),
  lowSoft: tokenRgb('--risk-low-soft'),
  mid: tokenRgb('--risk-mid'),
  midSoft: tokenRgb('--risk-mid-soft'),
  orange: tokenRgb('--risk-orange'),
  high: tokenRgb('--risk-high'),
  highSoft: tokenRgb('--risk-high-soft'),
  device: tokenRgb('--cat-device'),
  storage: tokenRgb('--cat-storage'),
});
