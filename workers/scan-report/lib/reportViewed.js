// CK-11491: "was the report viewed?". GA4 cannot answer it: the email button opens a fresh tab, which holds no scan consent, so the consent gate (rightly)
// sends nothing. This keeps the first view on the scan row (it follows the row's own retention rules) and adds 1 to the anonymous daily counter
// (public.learning_aggregate_daily, MPC-9892: day, dimension, key and a number, nothing else), so the total does not depend on the row.
// Test addresses are counted under their own key so they can never inflate the real funnel. Best effort: never throws, never costs the reader the page.
const hkDay = (now) => new Date(now.getTime() + 8 * 3600 * 1000).toISOString().slice(0, 10);

export async function markReportViewed(sb, scanId, { isTest = false, now = new Date() } = {}) {
  try {
    // Matches only while the column is still empty, so a refresh or the page's own polling counts nothing.
    const first = await sb.patch(`scans?id=eq.${scanId}&report_viewed_at=is.null`, { report_viewed_at: now.toISOString() });
    if (!Array.isArray(first) || first.length !== 1) return false;
    await sb.rpc('mpt_learning_count', { p_day: hkDay(now), p_dimension: 'funnel_step', p_key: isTest ? 'report_viewed_test' : 'report_viewed', p_n: 1 });
    return true;
  } catch (e) {
    console.error('report view not recorded:', e?.status || 'error');
    return false;
  }
}
