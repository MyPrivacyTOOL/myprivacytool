# Inbound Email Worker plan (MPC-8689) — plan only, nothing built

Owner decision 2026-10-29: build an inbound Email Worker for two hexagons only, later:

- `email.inbound_sender` "If they email us: sender details" (display name, address, reply-to)
- `email.inbound_client` "If they email us: mail app and timezone" (X-Mailer / User-Agent, and the timezone offset in the Date header)

Dropped: `email.inbound_signature` (reads the body, which holds personal data). `email.inbound_route` (sending servers) and `email.attachments` are not approved and stay candidates.

## What the owner must set up outside the repo (nothing here is done)

1. **Cloudflare Email Routing** on the receiving domain: enable it, verify the domain's MX/SPF records, and create one dedicated address (for example `check@…`) that routes to the Worker. Use a subdomain or a dedicated address so no existing mailbox is rerouted.
2. **A decision on the address people write to**, and where it is shown. The check works only when the person chooses to email us; we never email first.
3. **Consent wording, shown before the person writes**, approved by the owner/legal: what we read (the sender line and two headers), that the message body is never read or kept, what we show them, how long anything is kept (proposal: nothing is kept), and how to delete (STOP / the existing delete flow). This is a new user-facing notice.
4. **Retention rule** (proposal: derived fields are shown once in the reply and not stored; if the owner wants them stored, 90 days like the Telegram flags, with delete on request).
5. **A reply path**: Email Routing delivers inbound mail to a Worker, but sending the reply needs an outbound sender (the existing Resend setup in `workers/scan-report`, or the `send_email` binding). Owner picks which, and approves the reply text.
6. **A flag and allow-list**: a Worker var (proposal: `EMAIL_INBOUND_CHECK=on`) and an allow-list of sender addresses for testing, exactly like `PROBE_TELEGRAM_IDS`, until the owner releases it.

## Proposed design (for when the owner has done the above)

- A Worker `email(message, env)` handler. Read only `message.from`, `message.headers` (From, Reply-To, X-Mailer, User-Agent, Date) and never the body or attachments. `message.raw` is not read.
- Derived fields only: display name present yes/no and the address's domain, whether Reply-To differs from From, the mail app name from X-Mailer/User-Agent, and the UTC offset from Date. The full address is used only to send the reply.
- Results follow the same rules as everything else: a field present is `found`, a field absent in this message is "not in this message" (not "protected"), anything unreadable is `not_checked`. Never guessed.
- Same status as the other extras: `status: "new"`, flag-off, outside the 54, `scanCounts` and the exposure score.
- Reject and ignore mail that fails SPF/DKIM or comes from a no-reply or automated sender; rate-limit per sender; log counts only.
- Tests: synthetic messages only (no real mailbox); header parsing, timezone, absent headers, allow-list, flag off, body never read (assert `raw` is not touched), no storage, reply text.

## Risks to settle first

- Inbound mail can be forged: the reply must go only to an address that passed authentication, otherwise the Worker can be used to send mail to a third party.
- Display names and addresses are personal data even if the body is ignored; the consent notice must say so.
- The reply is outbound email, so the existing unsubscribe/suppression rules in `workers/scan-report` apply.
