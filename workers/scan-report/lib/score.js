// Privacy Health Score, MPC-076 v1.0 section 2.3:
//   score = 100 - sum(Signal_Risk x Signal_Severity x Data_Freshness), clamped to 0..100.
// Only categories that were actually checked contribute. Unchecked categories are reported as
// "not yet checked" and are never scored (no guessing). A score built from a subset is labelled partial.

export const CATEGORIES = {
  broker:       { label: 'Data broker profiles',            multiplier: 2.0 },
  search:       { label: 'Search engines & public records', multiplier: 1.2 },
  social:       { label: 'Social media exposure',           multiplier: 1.0 },
  email:        { label: 'Email & breaches',                multiplier: 1.5 },
  device:       { label: 'Device & browser fingerprinting', multiplier: 1.0 },
  network:      { label: 'Network & location',              multiplier: 1.0 },
  professional: { label: 'Professional & LinkedIn data',    multiplier: 1.0 },
  ai_threat:    { label: 'AI & emerging threats',           multiplier: 1.8 },
};
// Multipliers: broker 2.0, AI 1.8, social 1.0 are from the spec. email 1.5 and search 1.2 are our
// interpolation for the spec's HIGH / MEDIUM tiers - flagged for Chris in the task notes.

// Every signal this pipeline queries is fetched at run time, so Data_Freshness is 1.0
// ("found in last 24h"). Cached data older than 6 months would be 0.5 (not used yet).
export const freshness = (ageDays) => (ageDays <= 1 ? 1.0 : ageDays > 180 ? 0.5 : 0.75);

// Signal_Risk 1-10 for one HIBP breach: base 4, +3 if passwords exposed, +1 if sensitive, +1 if not "verified-only noise".
export function breachRisk(b) {
  const classes = (b.DataClasses || []).map((c) => String(c).toLowerCase());
  let r = 4;
  if (classes.some((c) => c.includes('password'))) r += 3;
  if (b.IsSensitive) r += 1;
  if (classes.some((c) => /phone|physical address|date of birth|government|credit card|social security/.test(c))) r += 1;
  return Math.min(10, r);
}

export function colorFor(score) {
  if (score === null) return '9ca3af';            // grey = not checked
  return score >= 70 ? '22c55e' : score >= 50 ? 'eab308' : 'ef4444';
}

// signals: [{category, risk (1-10), ageDays}]  checked: Set of category keys that were really queried
export function computeScore(signals, checked) {
  const byCat = {};
  for (const k of Object.keys(CATEGORIES)) byCat[k] = { exposure: 0, count: 0 };
  for (const s of signals) {
    const c = CATEGORIES[s.category];
    if (!c || !checked.has(s.category)) continue;
    byCat[s.category].exposure += s.risk * c.multiplier * freshness(s.ageDays ?? 0);
    byCat[s.category].count += 1;
  }
  let total = 0;
  const hexagons = Object.entries(CATEGORIES).map(([category, c]) => {
    const isChecked = checked.has(category);
    const e = byCat[category].exposure;
    total += e;
    const score = isChecked ? clamp(Math.round(100 - e)) : null;
    return { category, label: c.label, checked: isChecked, score, signals_count: byCat[category].count,
             risk_multiplier: c.multiplier, color: colorFor(score) };
  });
  const score = clamp(Math.round(100 - total));
  const unchecked = Object.keys(CATEGORIES).filter((k) => !checked.has(k));
  const risk_level = score >= 90 ? 'low' : score >= 70 ? 'medium' : score >= 50 ? 'high' : 'critical';
  return {
    score, risk_level, hexagons,
    signals_found: signals.filter((s) => checked.has(s.category)).length,
    partial: unchecked.length > 0,
    categories_checked: [...checked],
    categories_unchecked: unchecked,
  };
}
const clamp = (n) => Math.max(0, Math.min(100, n));
