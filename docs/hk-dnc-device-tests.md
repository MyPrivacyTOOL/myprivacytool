# HK DNC dial string: device test matrix (MPC-7450)

`buildDialString(platform, { register, language })` in `src/config/hkDnc.ts`. The IVR keys are UNVERIFIED (`IVR_VERIFIED = false`, MPC-7445), so every "auto-send" result below is only about whether the phone *transports* the keys; whether they are the *right* keys is unknown until the real menu is recorded.

**Status of this matrix:** the dial strings are exact (unit-tested). The sandbox that built this has no phone, no browser on a handset and no network route to a hotline, so **no cell below has been run on a real device**. "Expected" is what the platforms are documented/commonly reported to do; each one needs confirming on the handset named.

## What the function returns (register `all`, language `en`; keys from `src/config/hkDncIvr.json`, typed down by hand from a real call on 2026-10-13: language 3 = English, then service 3 = short messages, 1 = register this number, `*` = back to menu, then service 1 = pre-recorded, 1 = register this number)

| Platform | `dial` | `manualKeys` | `autoKeys` |
|----------|--------|--------------|------------|
| `android` | `tel:13571835000,,,3,,3,,1,,,,,,,,%2A,,1,,1` | `[]` | true |
| `ios` | same as Android | `[language, service, register, back, service, register]` shown on screen in large type as a backup | true |
| `other` (desktop, unknown) | `tel:13571835000` | same as iOS | false |

`,` = pause (about 2 s on Android; `PAUSES` in the config). `#` and `*`, if the real menu needs them, are percent-encoded (`%23`, `%2A`). `tel:1835000` without the 1357 prefix is available with `forceCallerId: false`.

## Test matrix

Run each row on the real handset from the landing page's dial button. Record the date and OS/browser version.

| # | Device / browser | Dial string used | Expected: dialer opens with number | Expected: pauses honoured | Expected: keys auto-send | Result |
|---|------------------|------------------|-----------------------------------|----------------------------|--------------------------|--------|
| 1 | iPhone, Safari | same as row 3 (changed 2026-10-13: iPhone now sends the keys with pauses; the large on-screen keys stay as a backup) | Yes, after the system "Call" confirmation sheet | Expected yes | Expected yes. If not, the user presses the large keys on screen | needs real device |
| 2 | iPhone, Chrome | same as row 3 | Yes, Chrome hands `tel:` to the system dialer (confirmation sheet) | Expected yes | Expected yes | needs real device |
| 3 | Android, Chrome | `tel:13571835000,,,3,,3,,1,,,,,,,,%2A,,1,,1` | Yes, opens the dialer pre-filled | Yes, `,` becomes a pause in the dialer | Yes, once the call connects, if the dialer honours pauses | needs real device |
| 4 | Android, Samsung Internet | same as row 3 | Yes, opens the Samsung dialer | Expected yes (Samsung dialer shows `,` as a 2 s pause) | Expected yes | needs real device |
| 5 | Android, Chrome, non-Samsung dialer (Pixel / Google Phone) | same as row 3 | Yes | Expected yes | Expected yes | needs real device |
| 6 | Desktop Chrome / Safari | bare `tel:` | Depends on a registered handler (FaceTime, Teams, Skype or nothing) | n/a | No | needs real device |

## What to record per row
1. Did the dialer open with `1357 1835000` filled in (not truncated at the first `,`)?
2. Did the call need an extra tap after the dialer opened?
3. Did the keys play automatically, and after how many seconds did the first one fire? (Compare to the IVR greeting length from `docs/hk-dnc-ivr-procedure.md`.)
4. Does the dialer show a "pause"/"wait" prompt instead of auto-sending (some dialers do this for `;` but not `,`)?
5. On iOS, does the on-screen key list stay visible after the call starts (user returns to the page)?

## Known risks to check
- Android dialer variants differ on how long a `,` is; if the IVR greeting is longer than `PAUSES.beforeFirstKey` the first key is lost. Tune after MPC-7445.
- iPhone: from 2026-10-13 the engine sends the same pauses and keys as Android, because the manual route needed the user to press keys by hand. Not yet proven on an iPhone. If rows 1/2 fail (keys dropped or the dialer stops at the first `,`), set iOS back to the bare number in `buildDialString` (`src/config/hkDnc.ts`); the large on-screen keys already work as the fallback.
- In-app browsers (Facebook, Instagram, WeChat, WhatsApp) may block or rewrite `tel:` links. Not in scope above; matters for the HK ads, so worth adding rows before paid traffic.
