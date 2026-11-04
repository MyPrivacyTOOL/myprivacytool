import { CATEGORIES } from './score.js';

// MPC-7261 Mirror Report: a structured, honest reflection of one scan. It states what we looked at,
// what we found, and what we could NOT check. It never guesses: unchecked categories carry no score.
// The report email and the follow-up emails are both built from this object.
export function buildMirrorReport({ scan, breaches = [], breachStatus, brokers = [] }) {
  const hexagons = scan.hexagons.map((h) => ({
    category: h.category,
    label: h.label,
    status: h.checked ? 'checked' : 'not_checked',
    score: h.checked ? h.score : null,
    signals: h.signals_count,
  }));
  const findings = breachStatus === 'checked'
    ? breaches.map((b) => ({ type: 'breach', title: String(b.Name || 'Unknown breach'), detail: (b.DataClasses || []).join(', ') }))
    : [];

  const steps = [];
  if (breachStatus !== 'checked') {
    steps.push({ id: 'check-breaches', title: 'Check your email against known breaches (free, about 10 seconds)', url: 'https://haveibeenpwned.com' });
  } else if (breaches.length) {
    steps.push({ id: 'change-passwords', title: 'Change the password on each breached service, and anywhere you reused it', url: null });
  }
  for (const b of brokers) {
    if (b.removal_url) steps.push({ id: `opt-out-${b.key}`, title: `Remove your ${b.name} listing`, url: b.removal_url });
  }
  return {
    version: 1,
    score: scan.score,
    risk_level: scan.risk_level,
    partial: scan.partial,
    coverage: { checked: scan.categories_checked.length, total: Object.keys(CATEGORIES).length },
    hexagons,
    findings,
    next_steps: steps,
  };
}
