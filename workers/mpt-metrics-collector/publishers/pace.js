// Pace maths for the weekly tracker (decision record D3). Mirrors the Notion formulas `Target Cumulative Scans`
// and `Pace Gap %`, which the connector cannot read back, so the Worker computes the status itself.
export const LADDER = [
  ['2026-07-07', 0], ['2026-09-30', 2000], ['2026-12-31', 4000],
  ['2027-03-31', 6000], ['2027-06-30', 8000], ['2027-08-01', 10000],
];
const DAY = 86400000;
const t = (d) => Date.parse(`${d}T00:00:00Z`);

// Straight-line interpolation along the locked ladder. Before the first date the target is 0; after the last it is the cap.
export function targetScans(dateIso) {
  const x = t(dateIso);
  if (x <= t(LADDER[0][0])) return LADDER[0][1];
  for (let i = 1; i < LADDER.length; i++) {
    const [d1, v1] = LADDER[i];
    if (x <= t(d1)) {
      const [d0, v0] = LADDER[i - 1];
      return v0 + ((v1 - v0) * (x - t(d0))) / (t(d1) - t(d0));
    }
  }
  return LADDER[LADDER.length - 1][1];
}

// Percent above (+) or below (-) target. Null when scans are unknown or the target is 0.
export function paceGapPct(cumulativeScans, weekOf) {
  if (cumulativeScans == null) return null;
  const target = targetScans(weekOf);
  if (!target) return null;
  return ((cumulativeScans - target) / target) * 100;
}

// Rule from the decision record: On Track at 0 or above, At Risk between 0 and -15 (inclusive), Behind below -15.
export function paceStatus(gap) {
  if (gap == null) return null;
  if (gap >= 0) return '🟢 On Track';
  if (gap >= -15) return '🟡 At Risk';
  return '🔴 Behind';
}

export const mondayOf = (dateIso) => {
  const d = new Date(t(dateIso));
  return new Date(d.getTime() - ((d.getUTCDay() + 6) % 7) * DAY).toISOString().slice(0, 10);
};
export const addDays = (dateIso, n) => new Date(t(dateIso) + n * DAY).toISOString().slice(0, 10);
