// CK-8503: the one vocabulary for where a web scan request is, derived ONLY from the persisted `scans` row.
// Read-only and not wired into any runtime path: nothing here changes behaviour, and it is not a second ledger. The `scans` table stays the
// queue and the record (MPC-6677, MPC-7406). An LLM's or a page's wording never feeds this; only the columns the report job and the provider
// receipt webhook (lib/receipts.js) write.
//
//   queued           row exists and is waiting (a durable acceptance: the request is acknowledged only after the insert)
//   recovering       a try failed and the job will try again (attempts so far and the error are on the row)
//   running          claimed by a report run
//   completed        the report email was ACCEPTED by the provider (Resend id stored). Not proof that it reached an inbox.
//   delivered        the provider reported it delivered (scans.delivery_status, from the signed webhook). The strongest receipt we can observe.
//   delivery_failed  the scan completed but the provider reported a bounce or failure: the person did not get the report; an operator must look
//   cancelled        the person unsubscribed before the report went out; nothing was sent
//   failed           tries used up or stuck; an operator must look (the alert in MPC-8406 fires)
//
// `delivered` needs a receipt. Without the webhook (RESEND_WEBHOOK_SECRET unset) a row stays `completed` for ever and `receipt` reads 'not_observed':
// that means "no receipt seen", not "not delivered". No row reaches `delivered` any other way.
export function requestLifecycle(scan) {
  const s = scan?.report_status;
  const attempts = scan?.report_attempts ?? 0;
  const err = scan?.report_last_error || null;
  const base = { attempts, error: err, receipt: scan?.delivery_status || 'not_observed' };
  if (s === 'sent') {
    if (!scan.resend_message_id) return { ...base, state: 'completed', delivery: 'unknown', error: null };
    if (scan.delivery_status === 'delivered' || scan.delivery_status === 'complained') return { ...base, state: 'delivered', delivery: 'delivered', error: null };   // a complaint means it arrived
    if (scan.delivery_status === 'bounced' || scan.delivery_status === 'failed') return { ...base, state: 'delivery_failed', delivery: 'undeliverable', error: null };
    return { ...base, state: 'completed', delivery: 'provider_accepted', error: null };
  }
  if (s === 'processing') return { ...base, state: 'running', delivery: 'not_sent' };
  if (s === 'failed') return { ...base, state: /^cancelled:/.test(err || '') ? 'cancelled' : 'failed', delivery: 'not_sent' };
  if (s === 'pending') return { ...base, state: attempts > 0 && err && !/^held:/.test(err) ? 'recovering' : 'queued', delivery: 'not_sent' };
  return { ...base, state: 'unknown', delivery: 'unknown' };
}
