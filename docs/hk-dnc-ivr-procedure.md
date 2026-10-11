# Hong Kong DNC hotline: record the real IVR menu (2 minutes)

**Why:** `src/config/hkDnc.ts` has `IVR_VERIFIED = false`. Every key in it is an UNVERIFIED placeholder. Until a person has called the hotline and written down the real menu, the `/HongKongSpam` page must stay `noindex`, unlinked, with no paid ads (MPC-7445 gates this). The OFCA FAQ gives the hotline (1835000) and the 1357 prefix, but not the menu keys.

**Who:** anyone with a Hong Kong mobile. **Cost:** free. **Time:** about 2 minutes, one call.

## Before you call
- Use your own phone with caller ID switched on. Registering is real: the call registers *your* number (free, no expiry, you can cancel from the same menu). If you do not want your number registered, stop before the final confirm key; you only need to listen and write down the menu.
- Have this file open on another device, or a notes app, to type into while you listen.

## The call
1. Dial **1835000** (or **13571835000** if your caller ID is withheld).
2. Do **not** press anything yet. Note how many seconds the greeting runs before the first menu (start a timer at "connected").
3. Write down, in the table below, every option you hear **in order**, in the language it is spoken. The menu repeats if you stay silent, so you can listen twice.
4. Choose the **English** path. Write each prompt and the key it asks for, down to the confirm step. Stop before the final confirm if you do not want to register.
5. Hang up, call again, and repeat for the **Cantonese** path (the language option is usually the first menu). Note whether the keys after the language choice are the same as in English.
6. For each register (SMS, pre-recorded, fax, all three together) write the key that selects it, if there is a choice.
7. Note any pause that matters: seconds from each key press to the next prompt being ready for input.

## Record it here
Date of call: `____`  Caller: `____`  Phone / carrier: `____`

| Step | Prompt (what you hear) | Key to press | Language | Seconds until ready for next key |
|------|------------------------|--------------|----------|----------------------------------|
| 0 greeting | | - | | |
| 1 | | | EN | |
| 2 | | | EN | |
| 3 | | | EN | |
| 4 confirm | | | EN | |
| 1 | | | Cantonese | |
| 2 | | | Cantonese | |
| 3 | | | Cantonese | |
| 4 confirm | | | Cantonese | |

Register selection keys: SMS `__`  pre-recorded `__`  fax `__`  all three `__` (or "no combined option": then list the sequence for each)

Anything unexpected (call-back offer, spoken confirmation of the number, how it says "registered"): `____`

## Then update the config
All key presses and pause lengths live in **`src/config/hkDncIvr.json`** (no code change needed to edit them).
1. Replace the `key` values with the recorded ones. Sequence pressed: language, menu ("register a number"), register choice, confirm. Language menu as reported 2026-10-11: 1 Cantonese, 2 Putonghua (Mandarin), 3 English.
2. Tune `pauses` (each unit is one `,`, about 2 seconds on Android) from the "seconds until ready" column.
3. Set `status` to `VERIFIED` only for keys confirmed on a real call by someone who understood the menu in that language.
4. When every key is `VERIFIED`, set `IVR_VERIFIED = true` in `src/config/hkDnc.ts` (a unit test checks the two agree), then run the device tests in `docs/hk-dnc-device-tests.md`.
5. Tell MPC-7446 the gate is clear.

**Who can do the call:** ideally someone who understands Cantonese, Putonghua and English, so each language path and the register wording can be checked. Parked for now (2026-10-11); the tool works with the current values and the page stays noindex until `IVR_VERIFIED` is true.
