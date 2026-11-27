# Email by channel, and inbound triage: design (not built)

Status: DESIGN, with three things live (2026-11-02): the taxonomy fields in `shared/email-map.js` (emailId, sequence, order, channel) with their CI checks (PR 701); the `email_id` and `channel` columns on `email_sends` (PR 702); and `recordSend()` writing them on every send (PR 704, verified live for the confirm and report emails). The channel ask, consent record and inbound triage below are NOT built.
The Notion twin of this page is linked from the strategy page "MPT > Email > Privacy Report Email, Strategy & Build Plan".

## What exists today
- `shared/email-map.js`: every sender, its class, trigger, audience and opt-out check. CI fails if a sender is unmapped.
- `email_sends` (MPC-7556): one row per email accepted by the provider, with `email_type`, delivery state and click count. No address.
- `email_suppressions` (MPC-7555): THE opt-out, one SHA-256 hash per address.
- Channels that capture contact details today: web scan, `/start` lead form, Hong Kong spam registration, referral, support inbox. WhatsApp / Telegram / Discord capture exists for hexagons (CK-8502) but none of them asks for an email.

## 1. Email IDs
`{SEQUENCE}-{checkpoint}`, for example `VIP-report-ready`. No position number in the ID: inserting an email must not rename the ones after it. Order in a journey is the `order` field. The old `VIP-1-report-ready` style in the Notion taxonomy is superseded.

## 2. Channel = where we asked, not the address
Each entry channel owns three things:
1. **The ask.** How the email is requested on that channel (WhatsApp reply, Telegram button, form field).
2. **The consent record.** What the person agreed to, on which channel, when (hash of the address plus channel plus timestamp; never the address in analytics).
3. **The first email.** A double-opt-in style confirmation whose `emailId` is in the map and whose channel is set.

All channels write to the same single opt-out. An unsubscribe from one email stops non-transactional email on every channel.

DECIDED (Chris, 2026-11-02), D1: a person reached on different channels is one person, merged on the hashed address, with the first channel kept as `first_channel`.

## 3. Change APPLIED to production 2026-11-02 (D3 approved by Chris)
The two columns below are live on `email_sends`, read-back verified. Nothing reads or writes them yet. The same idempotent SQL is in `supabase/migrations/20261102060000_mpc_9201_email_sends_email_id_channel.sql`.

```sql
-- additive; rollback: alter table public.email_sends drop column if exists email_id, drop column if exists channel;
alter table public.email_sends
  add column if not exists email_id text check (email_id ~ '^[A-Z]{2,5}-[a-z0-9-]{1,60}$'),
  add column if not exists channel  text check (channel in ('web-scan','lead-form','web-newsletter','referral','hk-spam','support-inbox','whatsapp','telegram','discord','any'));
create index if not exists email_sends_email_id_idx on public.email_sends (email_id, sent_at);
```
Worker side, DONE (PR 704, deployed 2026-11-02): `recordSend()` (`workers/scan-report/lib/emailSends.js`) writes `email_id` and `channel` next to `email_type` on each `email_sends` row, from the same idempotency-prefix table; a test checks that table equals this map. Verified live for the confirm and report emails; the other types show on their first real send. Resend tags were deliberately NOT added (they change what is sent to the provider).

## 4. Inbound triage (what Chris originally wanted from the Qwen review)
One step for everything that arrives at the support / hello inboxes:
- Categories: support, complaint, unsubscribe-by-reply, partner, sales-reply, data-request (DSAR), spam.
- Output per message: category, channel, suggested owner, urgency. Stored without the body: category counts and a message id.
- An unsubscribe-by-reply or a DSAR is never auto-answered; it is routed to a person and opens the existing opt-out / erase path.
- Replies to a person's own message stay human-reviewed until accuracy is measured.
- Classifier: a small model is enough for six categories. DECIDED (Chris, 2026-11-02), D2: score both Qwen (Alibaba Cloud's hosted API, as core-brain uses it today; already listed as the AI provider in the DPA, but a third party, not self-hosted) and Claude (Anthropic's API; NOT yet listed in the DPA or Privacy Policy, so it may not receive real messages until it is) on a labelled sample of 100 messages before choosing. The sample source still needs Chris's approval (real messages are personal data); tracked as MPC-9225.

## 5. Order of work after approval
1. DONE 2026-11-02: columns applied (D3) and every send records `email_id` and `channel` (PR 704).
2. Add the channel ask + consent record for one channel first (Telegram: already has capture).
3. Triage on a sample, human review, then measure.

## Not in scope
Writing new sequences (NL, MN, SALES, PN, PD), switching on state-driven follow-ups (MPC-8995), and anything that sends mail.
