// Hong Kong working-day engine for the DNC protection date (MPC-7450).
//
// OFCA: protection starts on the 10th working day after registration. A working day is any day except
// public holidays (every Sunday counts as one, Saturdays do not), black rainstorm days and gale warning days.
// Saturdays therefore count, unless the Saturday is itself a general holiday (e.g. 2026-04-04).
//
// Black rainstorm / gale days cannot be known in advance. They are a MANUAL adjustment: call
// addWeatherDays(date, n) with the number of such days that actually occurred. Nothing here is automated.
//
// All dates are plain 'YYYY-MM-DD' strings in Hong Kong time (UTC+8, no DST). No Date-timezone surprises.

/**
 * General holidays 2026 and 2027, from the HKSAR Government "general holidays" pages:
 *   https://www.gov.hk/en/about/abouthk/holiday/2026.htm
 *   https://www.gov.hk/en/about/abouthk/holiday/2027.htm
 * (2026 gazetted notice: https://www.info.gov.hk/gia/general/202505/16/P2025051300353.htm).
 * Sundays are excluded separately; Sunday-substitute days are listed here as the weekday that is observed.
 * NOTE: the sandbox that built this had no access to gov.hk, so the dates were transcribed from search
 * summaries of those pages and cross-checked against the Education Bureau 2026/27 calendar and the
 * lunar/Easter calendars. A human should re-confirm them against the URLs above before launch.
 */
export const HK_GENERAL_HOLIDAYS: readonly string[] = [
  // 2026
  "2026-01-01", // New Year's Day
  "2026-02-17", "2026-02-18", "2026-02-19", // Lunar New Year (days 1-3)
  "2026-04-03", // Good Friday
  "2026-04-04", // Day following Good Friday (Saturday)
  "2026-04-06", // Easter Monday (also the day following Ching Ming, which fell on Sunday 5 Apr)
  "2026-04-07", // Day following Easter Monday (substitute for the overlapping Ching Ming day)
  "2026-05-01", // Labour Day
  "2026-05-25", // Day following the Birthday of the Buddha (Sunday 24 May)
  "2026-06-19", // Tuen Ng Festival
  "2026-07-01", // HKSAR Establishment Day
  "2026-09-26", // Day following the Chinese Mid-Autumn Festival (Saturday)
  "2026-10-01", // National Day
  "2026-10-19", // Day following Chung Yeung Festival (Sunday 18 Oct)
  "2026-12-25", // Christmas Day
  "2026-12-26", // First weekday after Christmas Day (Saturday)
  // 2027
  "2027-01-01", // New Year's Day
  "2027-02-06", // Lunar New Year's Day (Saturday)
  "2027-02-08", // Third day of Lunar New Year
  "2027-02-09", // Fourth day of Lunar New Year (substitute for Sunday 7 Feb)
  "2027-03-26", // Good Friday
  "2027-03-27", // Day following Good Friday (Saturday)
  "2027-03-29", // Easter Monday
  "2027-04-05", // Ching Ming Festival
  "2027-05-01", // Labour Day (Saturday)
  "2027-05-13", // Birthday of the Buddha
  "2027-06-09", // Tuen Ng Festival
  "2027-07-01", // HKSAR Establishment Day
  "2027-09-16", // Day following the Chinese Mid-Autumn Festival
  "2027-10-01", // National Day
  "2027-10-08", // Chung Yeung Festival
  "2027-12-25", // Christmas Day (Saturday)
  "2027-12-27", // First weekday after Christmas Day
];

/** The holiday table is only trusted inside this window; outside it the functions throw. */
export const HOLIDAY_DATA_START = "2026-01-01";
export const HOLIDAY_DATA_END = "2027-12-31";

/** Working days after registration before protection starts. */
export const PROTECTION_WORKING_DAYS = 10;

const HOLIDAY_SET: ReadonlySet<string> = new Set(HK_GENERAL_HOLIDAYS);
const HK_OFFSET_MS = 8 * 60 * 60 * 1000;

const pad = (n: number) => String(n).padStart(2, "0");

function toUtcDate(iso: string): Date {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) throw new RangeError(`Expected YYYY-MM-DD, got "${iso}"`);
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  if (toIso(d) !== iso) throw new RangeError(`Invalid calendar date "${iso}"`);
  return d;
}

function toIso(d: Date): string {
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}

/** Calendar date in Hong Kong for an instant (Date, epoch ms or ISO timestamp), or pass through YYYY-MM-DD. */
export function toHkDate(input: Date | number | string): string {
  if (typeof input === "string" && /^\d{4}-\d{2}-\d{2}$/.test(input)) {
    toUtcDate(input);
    return input;
  }
  const t = input instanceof Date ? input.getTime() : new Date(input).getTime();
  if (Number.isNaN(t)) throw new RangeError("Invalid date");
  return toIso(new Date(t + HK_OFFSET_MS));
}

function addDays(iso: string, n: number): string {
  const d = toUtcDate(iso);
  d.setUTCDate(d.getUTCDate() + n);
  return toIso(d);
}

function assertCovered(iso: string): void {
  if (iso < HOLIDAY_DATA_START || iso > HOLIDAY_DATA_END) {
    throw new RangeError(
      `${iso} is outside the holiday data (${HOLIDAY_DATA_START}..${HOLIDAY_DATA_END}); add the next year's gov.hk list first`,
    );
  }
}

export function isHkGeneralHoliday(iso: string): boolean {
  return HOLIDAY_SET.has(iso);
}

/** Sundays and general holidays are not working days. Saturdays are. */
export function isHkWorkingDay(iso: string): boolean {
  assertCovered(iso);
  return toUtcDate(iso).getUTCDay() !== 0 && !HOLIDAY_SET.has(iso);
}

/** The date that is `n` working days after `iso` (n >= 0; the start day itself is never counted). */
export function addWorkingDays(iso: string, n: number): string {
  if (!Number.isInteger(n) || n < 0) throw new RangeError("n must be a non-negative integer");
  assertCovered(iso);
  let cur = iso;
  let left = n;
  while (left > 0) {
    cur = addDays(cur, 1);
    if (isHkWorkingDay(cur)) left--;
  }
  return cur;
}

/**
 * First day the registration protects the number: the 10th HK working day after the registration day.
 * Accepts an instant (converted to the Hong Kong date) or a YYYY-MM-DD string.
 */
export function protectionStartDate(registeredAt: Date | number | string): string {
  return addWorkingDays(toHkDate(registeredAt), PROTECTION_WORKING_DAYS);
}

/**
 * Manual adjustment: push a date back by `n` black rainstorm / gale warning days that actually occurred.
 * Each such day is not a working day, so the protection date moves to the n-th working day after `date`.
 * Not automated; whoever notices the weather days calls this and updates the stored protection_date.
 */
export function addWeatherDays(date: string, n: number): string {
  return addWorkingDays(date, n);
}
