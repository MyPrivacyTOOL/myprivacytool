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
1. In `src/config/hkDnc.ts` replace the placeholder keys in `LANGUAGE_KEYS` and `REGISTER_KEYS` with the recorded ones. If the real flow has a different number of steps, change the arrays: `getIvrKeys()` order is the press order.
2. Tune `PAUSES` (each `,` is about 2 seconds on Android) from the "seconds until ready" column.
3. Change each key's `status` from `"UNVERIFIED"` to `"VERIFIED"` (widen the `status` type) only for keys you actually heard.
4. Set `IVR_VERIFIED = true`, update `src/config/hkDnc.test.ts` (it currently asserts the flag is `false`), and run the device tests in `docs/hk-dnc-device-tests.md`.
5. Tell MPC-7446 the gate is clear.
