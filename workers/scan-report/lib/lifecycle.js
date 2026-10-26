// CK-8503: the one vocabulary for where a web scan request is, derived ONLY from the persisted `scans` row.
// Read-only and not wired into any runtime path: nothing here changes behaviour, and it is not a second ledger. The `scans` table stays the
// queue and the record (MPC-6677, MPC-7406). An LLM's or a page's wording never feeds this; only the columns the report job itself writes.
//
//   queued       row exists and is waiting (a durable acceptance: the request is acknowledged only after the insert)
//   recovering   a try failed and the job will try again (attempts so far and the error are on the row)
//   running      claimed by a report run
//   completed    the report email was accepted by the provider (Resend id stored). NOT proof that it reached an inbox.
//   failed       tries used up or stuck; an operator must look (the alert in MPC-8406 fires)
//   cancelled    the person unsubscribed before the report went out; nothing was sent
//
// delivery is the most we can observe today: 'provider_accepted' once resend_message_id is stored. There is no delivery/bounce webhook, so
// receipt is always 'not_observable' and this function never returns a 'delivered' state. Adding one needs a signed Resend webhook (see
// docs/scan-lifecycle-ck-8503.md, gap G4); until then no copy may say "delivered" for the email channel.
export function requestLifecycle(scan) {
  const s = scan?.report_status;
  const attempts = scan?.report_attempts ?? 0;
  const err = scan?.report_last_error || null;
  if (s === 'sent') return { state: 'completed', delivery: scan.resend_message_id ? 'provider_accepted' : 'unknown', receipt: 'not_observable', attempts, error: null };
  if (s === 'processing') return { state: 'running', delivery: 'not_sent', receipt: 'not_observable', attempts, error: err };
  if (s === 'failed') return { state: /^cancelled:/.test(err || '') ? 'cancelled' : 'failed', delivery: 'not_sent', receipt: 'not_observable', attempts, error: err };
  if (s === 'pending') return { state: attempts > 0 && err && !/^held:/.test(err) ? 'recovering' : 'queued', delivery: 'not_sent', receipt: 'not_observable', attempts, error: err };
  return { state: 'unknown', delivery: 'unknown', receipt: 'not_observable', attempts, error: err };
}
