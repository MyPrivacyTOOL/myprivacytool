# DRAFT, NOT APPROVED: "How we calculate your score"

**Status: APPROVED by Chris on 2026-10-26 (reply "approved" to the wording, the O-1 finding and the baseline migration) and published as `src/pages/ScoreMethod.tsx` at `/how-we-calculate-your-score`. The page generates its weights and bands from `shared/hexagon-registry/score.js`; this file is the approved text, kept for reference. Any change to the wording needs Chris again.**

---

## How we calculate your score

### What the number means

Your **exposure score** is a number from 0 to 100 that says **how much your browser revealed to us during the scan, with the more sensitive things counting for more**.

It is **not** a chance that something bad will happen to you. It is **not** a grade of how careful you are, and it does not compare you with other people. A high number means your browser shows a lot. It does not mean you did anything wrong.

### The three bands

| Score | Band |
|---|---|
| 0 to 39 | Low exposure |
| 40 to 69 | Medium exposure |
| 70 to 100 | High exposure |

[Today almost every complete scan lands in High, because most things a browser shows cannot be "clear": a browser always tells a site its language, for example. We would rather say that than hide it.]

### How it is worked out

We check up to 54 things (we call them hexagons). Each one ends up in exactly one of three states:

* **Found**: your browser showed us a real value.
* **Checked and clear**: we could check, and there was nothing to show. Only a few things can ever be clear.
* **Not checked**: we could not tell, the check failed or was blocked, or this site cannot check it. This is **not** the same as clear and **not** the same as found.

The things are grouped into nine categories. Each category gets its own exposure: the sensitivity of what was found, as a share of the sensitivity of everything we checked in it. Sensitive things count up to three times more than low-sensitivity ones. The categories are then combined, with these weights:

| Category | Weight |
|---|---|
| Browser fingerprint | 25% |
| Social accounts | 20% [cannot be checked from a web page today] |
| Security status | 15% |
| Storage | 10% |
| Behaviour tracking | 10% |
| Device and network, privacy, language, orientation | 5% each |

A category where nothing was checked is left out, and the others share the weight.

The result is rounded to a whole number, and halves round up.

### Coverage

**Coverage** is how much of the full list we were able to check: the things checked, divided by all 54. It is a different number from your score. A score with low coverage tells you less, because it is built from fewer checks. Things we could not check lower your coverage. They never raise or lower your score.

### While a scan is still running

The number you see while the scan runs is **provisional**. It uses only what has been checked so far, so it can change as more checks finish. The number at the end is the one to use.

### Versions and comparing scores

Every score is stamped with the version of this method, currently **exposure-v1**. If we ever change the method, scores from different versions cannot be compared, and we will say so. Scores saved before this method existed are marked "legacy" and are not compared with new ones. A different number between two versions does not mean your privacy got better or worse.

### What we do not do

We do not guess. Anything we could not check is shown as not checked. We do not turn a missing result into "safe" or "exposed".
