# Exposure score: copy draft for owner approval (MPC-11569)

**DRAFT. Nothing here is shipped, wired or shown to anyone.** It is wording the owner must approve before any page, report or email changes. Rules: Notion "MPT > Exposure scoring — the rules for every channel" (2026-11-27), sections 4 and 11.

## 1. The one sentence that ships with the change (rule 11)

The core's `methodChangeSentence()` is written for Telegram ("where it used to count every field the same", a percentage). It is **wrong for web**: the old web number was a 0 to 100 score weighted by category, not a count percentage. Proposed wording, neutral about direction (live shadow data showed the new method reads LOWER than v1 on every observed scan, so a sentence about "more exposure" would be false):

* **Web:** "Your web exposure number is now worked out a new way, so it can read differently from before. Each field now counts by how risky it is, and a field that did not come back stays in the total. Nothing about your device or your settings changed."
* **Email:** "This is a new, separate number for your email address. It is not added to your web number and cannot be compared with it."

## 2. Replace the report's "CHECKED AND CLEAR" (rule 4)

The report and the registry say CHECKED AND CLEAR for a field that did not come back. The rules forbid "clear", "protected", "safe" and "fixed" for that. Proposed: "DID NOT COME BACK" as the label, with the required line beneath it (exact, from the rules page): "This field did not come back in this scan. That can mean your settings hid it, or that you never filled it in - a single scan cannot tell the difference."

## 3. Display (rules 1, 5, 7), for the owner to confirm

* Always two numbers side by side: `Exposure 91 · 44 of 47 fields returned`.
* A stacked bar: grey "Always sent" (web 38 fields, email 3) under coloured "Your settings" (web 9, email 3). Floors: web 76, email 40.
* Position in the range you can change instead of a band: `63% of the range you can change (0% = nothing changeable is exposed, 100% = all of it is; the lowest possible score is 76)`.
* Fix list ordered by points recoverable: `24 points from 9 settings you can change`.

## 4. Not decided here

Whether the web headline switches to this method at all, and when; where the email number appears; any wording on the scan page, in the report email or on `/how-we-calculate-your-score`.
