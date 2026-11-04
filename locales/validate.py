#!/usr/bin/env python3
"""MPT-1003: validate locales JSON syntax and key parity with master_keys.json."""
import json, sys, pathlib
root = pathlib.Path(__file__).parent
master = json.loads((root / "master_keys.json").read_text(encoding="utf-8"))
keys = {k["key"] for k in master["keys"]}
bad = 0
for loc in master["_meta"]["locales"]:
    f = root / loc / "main.json"
    try:
        d = json.loads(f.read_text(encoding="utf-8"))
    except Exception as e:
        print(f"FAIL {f}: {e}"); bad += 1; continue
    if set(d) != keys:
        print(f"FAIL {f}: missing={sorted(keys-set(d))} extra={sorted(set(d)-keys)}"); bad += 1
    elif not all(isinstance(v, str) for v in d.values()):
        print(f"FAIL {f}: non-string value"); bad += 1
    else:
        print(f"OK   {f} ({len(d)} keys)")
sys.exit(1 if bad else 0)
