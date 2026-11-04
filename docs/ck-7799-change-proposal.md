# CK-7799 change proposal (step 1, no live changes)

Source: Exposure card rating E1/E2 results page (Notion, "All 54 hexagons in interest order"). Built from 21 AI personas, one model, confidence about 30%. **These are hypotheses.** No conversion, price or uplift claim is made or implied anywhere below.

**GATE.** Steps 2 to 6 ship only after the real-people card sort (MPC-7725 part B, CK-7730 step 6) has run and its result is recorded and linked in the PR. If real people disagree with the swarm, follow the real people and say so here. This commit changes no site code.

Top six by combined score: 1 WebRTC Leak, 2 Canvas Fingerprint, 3 DNS Leak, 4 Keystroke Dynamics, 5 WebGL Signature, 6 Audio Signature (ids: `webrtc-leak`, `canvas-fingerprint`, `dns-leak`, `typing-patterns`, `webgl-fingerprint`, `audio-fingerprint`). Ranks 22 to 54 are the "ordinary" group.

## 2. Reveal order
- **Before:** `HexagonGrid.tsx` `getOrderedHexagons` sorts by a fixed category list (device, network, privacy, profile, language, orientation, fingerprint, storage, social, security, behavior). Device and browser appear first.
- **After:** sort by the interest rank above, then by category for ties. The rank table lives in one place in `shared/hexagon-registry`, not inline in the component. Hexagons the browser cannot produce (WebRTC, canvas, WebGL, audio are conditional) are simply skipped, so the first visible ones are the top-ranked that exist for that browser.
- **Files:** `src/components/HexagonGrid.tsx`, `shared/hexagon-registry/registry.js` (+ `registry.d.ts`, `registry.test.mjs`).
- **Risk:** the reveal waves and the hard-coded 46/52 in `HexagonGrid.tsx` index into this order; check them with the new order.

## 3. Free teaser
- **Before:** the header line says "We found {visibleCount} data points about you without asking." and the first items shown are device and browser.
- **After:** name 2 to 3 of the top six actually found for this browser, then "plus N more things". N is the real count for that browser (41 always, plus up to 13 conditional), never a fixed number. Wording to be signed off by the owner; draft: "We found your WebRTC leak status, your canvas fingerprint and your DNS leak status, plus N more things."
- **Files:** `src/components/HexagonGrid.tsx` (header), the count from `registry.js`.

## 4. Explainers (top six, one plain sentence each, no alarm words)
- **Before:** `getHexagonInsight` in `src/components/VoiceAI.tsx` has long strings, some with numbers that are not backed by the scan (for example "makes you 99% trackable" for canvas, "About 35% of users share your exact hardware profile").
- **After:** one sentence per top-six item, each checkable against what the detector does. Draft (owner to approve): WebRTC "Some browsers can show a site your real network address even behind a VPN." / Canvas "Your browser draws a hidden image in a way that can help a site recognise your device." / DNS "Your DNS requests can reveal which network is looking up a site." / Keystroke "How you type can be measured as a rhythm." / WebGL "Your graphics hardware can be read as part of a device signature." / Audio "Tiny differences in how your device processes sound can add to a device signature."
- **Open item:** the existing "99%" and "% of users" lines are untrue-by-construction. Replacing them for these six is in scope. The rest are a separate cleanup I will list, not change.
- **Files:** `src/components/VoiceAI.tsx`, a new test.

## 5. Trust Report
- **Before:** there is no Trust Report page in this repo. `/trust` is the Trust Centre (links and policy); the Trust Report is a concept (CK-7728 part C), gated on CK-7721 part A, the licence decision and the voice test.
- **After:** the "what we hid" section order is a spec for that page: leak and fingerprint families first, ranks 22 to 54 collapsed into one "ordinary things every site sees" line with a real count. **I will not build the page in this task.** Plan: add the spec to the PR description and, if the page exists by merge time, apply it there; otherwise hand the spec to CK-7728 part C.
- **Files:** none now.

## 6. Alice script
- **Before:** `VoiceAI.tsx` speaks each hexagon in whatever order it is confirmed, all 54.
- **After:** speak the top three first, skip ranks 40 to 54 unless the visitor asks, keep the calm voice. Wording goes to the owner for sign-off before it goes live.
- **Files:** `src/components/VoiceAI.tsx`.

## 7. Process
PR from this branch with the PR template (copy-change tick-box: link the card sort result). CI green. Merge only when the owner has approved the copy. Result Summary signed from the machine clock.

## 8. Optional (owner decision)
Ask the MPC agent whether the paid cleanup really addresses WebRTC and DNS leaks, before any copy promises a fix. Until then no copy says it fixes them. The existing WebRTC insight already suggests "disabling WebRTC or a leak prevention extension"; that wording stays about the browser, not the paid product.

## Not doing
Spend (zero), cloud services, A/B tests, the word "open source", any claim that these changes raise conversion or sales.
