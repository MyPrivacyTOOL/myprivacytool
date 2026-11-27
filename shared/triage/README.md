# Plain-rules check for inbound mail (MPC-9783)

`rules.js` flags a message that asks us to stop emailing, or about the personal data we hold (access, copy, correct, delete, withdraw consent, transfer). It runs before any classifier model and routes to a person and the existing opt-out / erase path. It returns rule names only, never the text.

## How good is it? Measured, not assumed
Hand-written keyword rules fit the messages they were written against. Honest numbers, each from the FIRST run on a set the rules had not seen:

| Set | Caught on first run | Then |
| --- | --- | --- |
| Dev set (100 synthetic, `scripts/triage-eval`) | 30 of 30 | patterns were written while reading these, so this proves little |
| `heldout.json` (16 should-catch) | 6 of 16 | rules broadened; now 16 of 16 (tuned on) |
| `heldout2.json` (20 should-catch) | 7 of 20 | rules broadened; now 20 of 20 (tuned on) |
| `heldout3.json` (15 should-catch) | 3 of 15 | not tuned on; kept as the realistic recall measurement |

False alarms on ordinary messages: 0 on every set except one known case ("deleted my progress", "deleted it as spam").

**Conclusion:** the rules alone catch roughly a quarter to a third of unseen phrasing. They are a cheap extra net with almost no false alarms, NOT the safety guarantee. The guarantee has to come from the design around them: every message reaches a person and nothing is auto-discarded (see the Notion task MPC-9783), plus a dedicated model check for opt-out/data-request wording.

Regenerate the sets: they are plain JSON; add new fresh sets rather than tuning on `heldout3`.

## The triage module (MPC-9783, decisions T4, T5, T6 by Chris, 2026-11-07)

| File | Role |
| --- | --- |
| `prompts.js` | The ONE copy of the model prompts. The production module and `scripts/triage-eval` both import it: what was measured is what runs. |
| `parse.js` | Reading a model reply; anything unreadable is INVALID, never guessed. |
| `qwen.js` | The only place that talks to the model. No tools or functions are offered; the key goes in the Authorization header only. |
| `rules.js` | The plain keyword rules (extra layer, see above). |
| `triage.js` | `triage(message, {ask})`: rules + the yes/no check + the category -> flagged / kind / queue / urgency / owner. Metadata only. Off unless `TRIAGE_ENABLED === "true"`. |
| `alert.js` | The Slack alert a person sees (metadata only; the function never receives the message text). |

Guarantees the tests pin (and fail if broken): every message reaches a person (`discard` is always false; spam is a LOW-priority queue, not a bin); the plain rules, a model "yes", or ANY failure/unreadable answer of the yes/no check raises a message to the priority owner; a failed category check gives "unclassified", still queued; the result and alert never hold the message body, an address or a name.

**Measured (synthetic messages only):** the yes/no check caught 81 of 81 should-flag messages, including 51 phrased in ways it had never seen; it raised 6 of 119 ordinary messages. Real mail is the real test and needs Chris's approval of a sample source first.

**Not done / not wired:** nothing calls `triage()` from live mail yet; the Slack channel and bot access are Chris's to create; the six case-record columns are APPLIED to production (`docs/triage-case-columns-draft.md`, Chris's approval 2026-11-07) but nothing writes them yet.
