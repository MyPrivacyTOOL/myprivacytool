# Kling AI Prompt Engineering Guidelines

**Task:** CK-5139 — Document Kling AI Prompt Engineering Guidelines
**Project:** Dolphins Intuition (Kling AI video pipeline)
**Scope:** Consistent character appearance, prompt templates, parameter settings, quality-control checkpoints, video length optimization, cost tracking integration.

> Facts marked **[Verified]** come from the fleet's Video Toolkit page (2026-08-11). Items marked **[To validate]** are recommended practice that has not yet been confirmed against the deployed pipeline; validate with one cheap test generation before batching.

---

## 1. Ground rules

1. **Mode B governance applies.** Generative video needs a human-origin trigger and written justification (CK-VIDEO-GUARD-002). If FFmpeg/MoviePy can do the job on existing footage, do that instead (CK-VIDEO-AUTH-001).
2. **Image-to-video beats text-to-video for character consistency.** Anchor every shot on an approved reference still; use text-to-video only for establishing shots with no recurring character.
3. **Use the right model for the job.** [Verified] `kling-v2-master` is text2video only and silently stalls on image2video jobs. For animating a still use `kling-v1-6` (fleet default). Kling 2.0/2.1 Master costs ~5x and is 1080P-only — do not use for this pipeline.
4. **Clips cap at 10s per generation.** Plan shots as 5s (default) or 10s clips and cut/concat in Mode A.

---

## 2. Character consistency system

### 2.1 Character bible entry (one per character)

Keep a fixed, versioned description block. Never paraphrase it between shots — copy/paste verbatim.

```
CHARACTER: <name> (bible v<N>)
IDENTITY: <species/age/build>, <height/proportions>
FACE/HEAD: <distinct features, e.g. "dark grey dorsal, white belly, scar above left eye">
CLOTHING/ACCESSORIES: <exact garments, colours, materials>
PALETTE: <3-4 named colours>
FORBIDDEN DRIFT: <things that must not change: eye colour, markings, outfit>
REFERENCE IMAGES: <paths/URLs of approved stills, front / 3-quarter / profile>
```

### 2.2 Reference-image rules

- Generate/approve a **canonical still** per character (neutral pose, plain background, even lighting) before any video work.
- Use the same still as the `image` input for every clip of that character in an episode.
- For multi-character shots, prefer Kling's multi-image / element reference features **[To validate against the deployed API version]**.
- Retire and regenerate the reference if the character bible changes; log the new version.

### 2.3 Consistency tactics

- Keep the **character block first** in the prompt so it carries the most weight.
- Keep **style/lighting/camera language constant** across an episode (one style block reused).
- Describe **only the motion** in image2video prompts — the image already defines appearance. Re-describing appearance invites drift.
- Avoid extreme angle changes, rapid cuts, and occlusion within a single clip; split into separate clips instead.

---

## 3. Prompt templates

### 3.1 Structure

```
[CHARACTER BLOCK] + [ACTION / MOTION] + [SETTING] + [CAMERA] + [LIGHTING / STYLE] + [CONSTRAINTS]
```

### 3.2 Image-to-video (default for recurring characters)

```
prompt:
  {character_block_short}. {single clear action, present tense, 1 sentence}.
  Camera: {static | slow push-in | gentle pan left | tracking shot}.
  {style_block}. Character appearance unchanged, consistent face and outfit.
negative_prompt:
  extra limbs, deformed face, changing outfit, colour shift, text, watermark,
  flicker, morphing, blurry, low quality
```

Example:

```
prompt: Livingstone the dolphin surfaces beside a small boat and turns his head toward the camera.
        Camera: slow push-in. Soft morning light, painterly documentary style.
        Character appearance unchanged, consistent face and markings.
```

### 3.3 Text-to-video (establishing shots / no recurring character)

```
{setting and subject}. {motion}. Camera: {movement}. {style_block}. {lighting}.
```

### 3.4 Prompt hygiene

- **One action per clip.** Multi-step choreography in 5s produces mush.
- Positive phrasing for motion; put unwanted artefacts in `negative_prompt`.
- Be concrete (materials, colours, named camera moves), avoid abstract adjectives ("epic", "beautiful").
- Keep prompts short (roughly 40-80 words); the reference image carries the detail.
- Change **one variable at a time** when iterating so you can attribute the result.

---

## 4. Parameter settings

| Parameter | Recommended | Notes |
|---|---|---|
| `model_name` | `kling-v1-6` for image2video | [Verified] Never `kling-v2-master` for image2video |
| `mode` | `std` for drafts/tests, `pro` for finals | See billing caveat below |
| `duration` | `'5'` default, `'10'` only when needed | Max 10s per generation |
| `cfg_scale` | `0.5` (deployed default) | Higher = stricter prompt adherence but more artefacts/stiffness; lower = more freedom. Tune in 0.3-0.7 **[To validate]** |
| `aspect_ratio` | `9:16` Shorts, `16:9` long-form | Match the platform target up front; don't crop later |
| `negative_prompt` | Standard block (3.2) | Reuse verbatim |

**Billing caveat [Verified, unresolved]:** Kling prices by resolution (720P/1080P), the API exposes `std`/`pro`. `std`→720P, `pro`→1080P is an inference. Confirm by reading Expense center → Account Overview before/after one generation and record the answer.

**Two-wallet trap [Verified]:** Only API Platform resource packages (kling.ai/dev) fund the API. Consumer membership credits on klingai.com do not.

---

## 5. Quality control checkpoints

Run these gates in order; fail fast, because every regeneration costs money.

| # | Gate | Check | On fail |
|---|---|---|---|
| 0 | Pre-flight | Human trigger recorded; KLING key present (dolphinsintuition agent only); balance above threshold (CK-5613 probe) | Stop, do not start batch |
| 1 | Reference approval | Canonical still matches character bible v<N> | Regenerate the still, not the video |
| 2 | Test clip | One cheap `std` 5s clip per new character/setting | Adjust prompt/cfg, not multiple variables at once |
| 3 | Per-clip review | Face, markings, outfit, palette match reference; no morphing, extra limbs, text artefacts; motion matches prompt | Regenerate (max 3 attempts, then revise prompt/reference) |
| 4 | First/last-frame check | Extract first and last frames (`ffmpeg -i clip.mp4 -vf "select=eq(n\,0)" ...`); compare to reference — drift shows at the tail | Trim tail with `video_cut` if only the end drifts |
| 5 | Sequence review | Concat clips; check character continuity across cuts, audio, pacing | Regenerate the offending clip only |
| 6 | Delivery | Resize to platform target (`video_resize`), verify with `video_info` | — |

**Pixel-level validation** (as pursued in CK-7008) is the strongest automated gate for character lock: compare cropped character regions against the reference and set a numeric threshold once calibrated **[To validate]**.

Attempt log: record prompt, seed/task ID, params, verdict and reason for each clip. Repeated failures for the same reason mean the *prompt or reference* is wrong — stop regenerating.

---

## 6. Video length optimization

### Shorts (15-60 s)

- 3-8 clips of 5s; a 15s Short = 3 clips, 30s = 6, 60s = 12 (or 6 x 10s).
- Hook in the first 1-2s: open on the most distinctive character moment.
- 9:16, one clear action per clip, hard cuts every 3-5s.
- Prefer `std` for drafts and only re-run winning shots at `pro`.

### Long-form (3-8 min)

- Build as **scenes of 4-10 clips**; total generated footage is far less than runtime.
- **Do not generate every second.** Cover narration with a mix of: generated hero shots, held/slow-zoomed stills (Ken Burns via MoviePy), and reused clips (Mode A costs $0).
- Establish one canonical style block and one canonical character set per episode to avoid drift.
- Generate in parallel within the plan's concurrency limit (Trial: 5, Standard: 20).
- Budget generation at roughly 20-40% of runtime; the rest is Mode A assembly.

### General

- Cost is **per second of generated output**, so shorter clips that succeed first time beat long clips that fail.
- Use 5s clips by default; use 10s only for slow continuous motion that cannot be cut.
- Video extension is billed per call, not per second; it is often worse for consistency than a fresh image2video clip from a new keyframe.

---

## 7. Cost tracking integration

**Rates [Verified 2026-08-11]:** 1 Unit = $0.14. Kling 1.6: 0.4 U/s (720P, $0.056/s), 0.7 U/s (1080P, $0.098/s). 2.5 Turbo / 2.6: 0.3 U/s (720P). Confirm on the live pricing page before large batches.

**Estimate before every batch:**

```
estimated_cost = total_generated_seconds x rate_per_second x (1 + retry_factor)
```

Use `retry_factor` = 0.5 while learning a character, 0.2 once stable. Rule of thumb at current settings: ~$0.50 per 5s clip at `pro`.

**Log per generation** (feed the Notion cost system; see CK-5717 for reconciliation with the droplet cost tracker):

| Field | Example |
|---|---|
| task_id / episode / shot | CK-5134 / EP03 / S07 |
| character + bible version | Livingstone v3 |
| model, mode, duration, cfg_scale | kling-v1-6, pro, 5, 0.5 |
| units consumed | 3.5 |
| est. cost / actual cost | $0.49 / from balance delta or Kling deduction-details API |
| attempt # / verdict | 2 / pass |

**Controls:**

- Preflight balance probe: refuse to start a batch below threshold (silent credit exhaustion looks like a stall).
- Reconcile weekly: log totals vs Kling Deduction Details API vs Account Overview.
- Trial packages expire in 30 days with no rollover; buy against a proven pipeline.
- Flag any batch whose estimate exceeds the per-task budget for human approval.

---

## 8. Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| Job never completes | `kling-v2-master` on image2video, or credits exhausted | Use `kling-v1-6`; check balance |
| Face/markings drift mid-clip | Appearance re-described in prompt, or too long/complex action | Motion-only prompt, shorter clip, split action |
| Outfit or colour changes between clips | Character block paraphrased, different reference stills | Verbatim character block, single canonical still |
| Stiff, over-literal motion | `cfg_scale` too high | Lower toward 0.3-0.4 |
| Ignores the prompt | `cfg_scale` too low or prompt overloaded | Raise slightly, one action per clip |
| Text/logos garbled | Model limitation | Add text in post via `video_overlay_text` |
| Costs higher than estimate | `pro` billed at 1080P, retries not budgeted | Confirm mode billing; add retry factor |

---

## 9. Open items

- Confirm `std`/`pro` to 720P/1080P billing mapping.
- Confirm whether Kling 2.5 Turbo/2.6 support image2video (25% cheaper than 1.6).
- Audit the deployed pipeline against Kling API 2.0 (model-specific endpoints, new auth).
- Calibrate a numeric character-lock threshold for automated QC.
- CK-5139's Notion task is currently quarantined (no Owner, empty Input Spec); set an Owner and Input Spec, then Status_Readiness = Ready.

## References

- Video — Fleet Toolkit & Playbooks (Notion): pricing, credentials, drift notes
- CK-5717 (cost reconciliation), CK-5613 (preflight balance probe), CK-6768 / CK-7008 (Livingstone character lock)
