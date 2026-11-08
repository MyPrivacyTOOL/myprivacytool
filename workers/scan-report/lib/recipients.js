// MPC-9885: the one place this Worker builds its recipient context. Every outbound call goes through callRecipient / recipientFetcher
// (shared/recipients/outbound.ts) with a literal registry key and the data items the request carries.
// A context is built once per request or job and threaded; a lib called without one (a test, an older caller) builds its own from env + fetchImpl.
// `fetchImpl` stays the test seam. When it is undefined the context falls back to globalThis.fetch.
import { workerRecipientContext } from '../../../shared/recipients/worker-ctx.ts';

export { workerRecipientContext };

/** The context a lib should use: the one it was handed, else a fresh one with no scan id (writes no scan_recipient_log rows). */
export const rcx = (env, fetchImpl, rctx) => rctx ?? workerRecipientContext(env, { fetchImpl });

/** Writes the scan's buffered scan_recipient_log rows. A failure here never changes the result of the scan. */
export async function flushQuietly(rctx) {
  try { await rctx?.flush?.(); } catch { /* the log never breaks or changes the work it describes */ }
}
