// MPC-7651: $0.10 per scan with volume discounts. The brief gives the base price only; the tier boundaries and the two
// discounted rates below are a PROPOSAL for Chris to confirm before the first invoice. Graduated: each band is charged at its own rate.
export interface Tier { upTo: number | null; microUsd: number }
export const TIERS: readonly Tier[] = [
  { upTo: 10_000, microUsd: 100_000 },   // first 10,000 scans / month: $0.10
  { upTo: 100_000, microUsd: 80_000 },   // 10,001 - 100,000:           $0.08
  { upTo: null, microUsd: 60_000 },      // above 100,000:              $0.06
];

export interface Band { from: number; to: number; scans: number; rate_usd: number; amount_usd: number }

export function priceMonth(billableScans: number): { amount_usd: number; bands: Band[] } {
  const bands: Band[] = [];
  let floor = 0;
  let micro = 0;
  for (const t of TIERS) {
    const ceil = t.upTo ?? Infinity;
    const scans = Math.max(0, Math.min(billableScans, ceil) - floor);
    if (scans > 0) {
      const amount = scans * t.microUsd;
      micro += amount;
      bands.push({ from: floor + 1, to: floor + scans, scans, rate_usd: t.microUsd / 1e6, amount_usd: amount / 1e6 });
    }
    floor = ceil;
    if (billableScans <= ceil) break;
  }
  return { amount_usd: Math.round(micro / 1e4) / 100, bands };
}
