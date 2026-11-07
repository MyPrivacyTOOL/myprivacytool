// MPC-9826 (F7a): ONE source for what we say about replying to an Alice email, used by the confirmation email, the report email
// (workers/scan-report/lib/email.js) and the FAQ (src/data/faqs.ts), so they cannot drift apart. The tests compare all three.
// Truth today (ledger EXT-01, C25b/C22): a reply goes to a mailbox on the MyPrivacyTOOL team (a person), NOT to Alice; the Alice
// conversation (inbound triage, MPC-9783) is not built, so it carries the Decision 6 marker, in plain text for email: "(coming)".
// No response-time promise is made: nothing in the repo shows the mailbox is monitored on a schedule.
export const REPLY_SENTENCE = 'Reply to this email and a person on the MyPrivacyTOOL team will read it and answer, with Alice’s help.';
export const ALICE_COMING_SENTENCE = 'A conversation with Alice herself in this thread (coming).';
export const REPLY_PROMISE = `${REPLY_SENTENCE} ${ALICE_COMING_SENTENCE}`;
// Alice's standing sign-off (Chris, 2026-10-10): the brand narrator, with the AI assistance disclosed.
export const SIGN_OFF_LINES = ['Alice, MyPrivacyTOOL', 'Our AI guide. This email was written with AI assistance.'];
