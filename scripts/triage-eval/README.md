# Inbound mail triage: synthetic evaluation (MPC-9225)

Chooses the classifier for inbound mail (Qwen or Claude) on **synthetic** messages only. Nothing here reads real mail, and nothing real may be added to `dataset.jsonl`.
Design and decisions: Notion "MPT > Email > Channel email capture and inbound triage, DESIGN" (MPC-9201), decision D2.

## Files
| File | What |
| --- | --- |
| `build-dataset.py` | The 100 invented messages (7 categories) and their labels. Run it to regenerate the two files below. |
| `dataset.jsonl` | Messages only (`id`, `text`), shuffled, no labels. This is what a classifier sees. |
| `labels.json` | `id` -> category. Keep it away from a classifier you want to run blind. |
| `prompt.md` | The classification rules both models are given (the message is untrusted data; category definitions). |
| `run-model.mjs` | Runs `dataset.jsonl` through an OpenAI-compatible endpoint (Qwen via DashScope by default) and writes predictions. |
| `score.mjs` | Accuracy, per-category recall, confusions, and the SAFETY count (see below). |
| `results-claude-sonnet.json` | Claude's blind predictions (2026-11-02). |
| `run-model.test.mjs` | Tests the runner and scorer against a local mock endpoint. Runs in CI. |

## Score a model
```bash
node scripts/triage-eval/score.mjs scripts/triage-eval/results-claude-sonnet.json
QWEN_API_KEY=... node scripts/triage-eval/run-model.mjs /tmp/qwen.json && node scripts/triage-eval/score.mjs /tmp/qwen.json
```
Or run the manual workflow **Triage eval (Qwen, synthetic only)**: it needs the repo secret `QWEN_API_KEY`.

## The safety metric
A `data_request` (access, deletion, correction, consent withdrawal) or `unsubscribe_by_reply` that is filed as anything else could be auto-answered or ignored. `score.mjs` counts those separately as SAFETY. Target: 0, and the production design must not depend on the model alone for them (see the Notion results page).

## Results so far
| Model | Accuracy | SAFETY misses | Run |
| --- | --- | --- | --- |
| Claude (Sonnet, blind subagent) | 97/100 | 1 | 2026-11-02 |
| Qwen | not run yet | not run yet | needs `QWEN_API_KEY` |

Caveat: the messages and labels were written by Claude, so this set may favour Claude. Treat the Claude-vs-Qwen gap as indicative until a labelled sample of real mail (approved source, MPC-9225) confirms it.
