// Hong Kong day arithmetic (MPC-7378 follow-up). The project reports in Hong Kong time (HKT, UTC+8, no DST):
// a "day" is 00:00 to 24:00 HKT, a week starts on Monday HKT. All stored period_start/period_end are real instants.
export const HK_OFFSET_MS = 8 * 3600000;
const DAY_MS = 86400000;

// HK calendar date (YYYY-MM-DD) of an instant.
export const hkDate = (d) => new Date(d.getTime() + HK_OFFSET_MS).toISOString().slice(0, 10);
// The instant at which the HK day containing `d` began.
export const hkDayStart = (d) => new Date(Math.floor((d.getTime() + HK_OFFSET_MS) / DAY_MS) * DAY_MS - HK_OFFSET_MS);
// 0 = Sunday .. 6 = Saturday, as seen in Hong Kong.
export const hkWeekday = (d) => new Date(d.getTime() + HK_OFFSET_MS).getUTCDay();
// The instant a HK date string (YYYY-MM-DD) begins.
export const hkDayStartOf = (day) => new Date(Date.parse(`${day}T00:00:00Z`) - HK_OFFSET_MS);

// The previous complete HK day relative to `now`.
export function previousHkDay(now = new Date()) {
  const end = hkDayStart(now);
  const start = new Date(end.getTime() - DAY_MS);
  return { start, end, day: hkDate(start) };
}
// The previous complete Monday..Sunday HK week relative to `now`.
export function previousHkWeek(now = new Date()) {
  const today = hkDayStart(now);
  const daysSinceMonday = (hkWeekday(now) + 6) % 7;
  const end = new Date(today.getTime() - daysSinceMonday * DAY_MS);
  const start = new Date(end.getTime() - 7 * DAY_MS);
  return { start, end, startDay: hkDate(start), endDay: hkDate(new Date(end.getTime() - DAY_MS)) };
}
