# Email by channel, and inbound triage: design (not built)

Status: DESIGN ONLY. Nothing here is live. The only code that ships with this page is the taxonomy fields in `shared/email-map.js` (emailId, sequence, order, channel) and their CI checks.
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

Open decision for Chris (D1): when someone first reached us on WhatsApp and later also arrives by web scan, is that one person (merge on the hashed address) or two journeys? Recommendation: one person, with the first channel kept as `first_channel`.

## 3. Draft change (NOT applied, NOT in `supabase/migrations/` on purpose)
So the deploy-supabase workflow cannot pick it up. To be reviewed and moved by a person when approved.

```sql
-- additive; rollback: alter table public.email_sends drop column if exists email_id, drop column if exists channel;
alter table public.email_sends
  add column if not exists email_id text check (email_id ~ '^[A-Z]{2,5}-[a-z0-9-]{1,60}$'),
  add column if not exists channel  text check (channel in ('web-scan','lead-form','web-newsletter','referral','hk-spam','support-inbox','whatsapp','telegram','discord','any'));
create index if not exists email_sends_email_id_idx on public.email_sends (email_id, sent_at);
```
Worker side (also not done): `sendEmail()` passes `emailId` and `channel` from the map instead of deriving `email_type` from the idempotency prefix, and adds both as Resend tags.

## 4. Inbound triage (what Chris originally wanted from the Qwen review)
One step for everything that arrives at the support / hello inboxes:
- Categories: support, complaint, unsubscribe-by-reply, partner, sales-reply, data-request (DSAR), spam.
- Output per message: category, channel, suggested owner, urgency. Stored without the body: category counts and a message id.
- An unsubscribe-by-reply or a DSAR is never auto-answered; it is routed to a person and opens the existing opt-out / erase path.
- Replies to a person's own message stay human-reviewed until accuracy is measured.
- Classifier: a small model is enough for six categories. Decision D2: Qwen (self-hosted, no message leaves our infrastructure) or Claude (better on ambiguous mail, message goes to the API). Recommendation: start with a labelled sample of 100 real messages and score both before choosing.

## 5. Order of work after approval
1. Apply the draft migration and wire `sendEmail()` (needs Chris's go for production).
2. Add the channel ask + consent record for one channel first (Telegram: already has capture).
3. Triage on a sample, human review, then measure.

## Not in scope
Writing new sequences (NL, MN, SALES, PN, PD), switching on state-driven follow-ups (MPC-8995), and anything that sends mail.
