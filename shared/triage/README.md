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
