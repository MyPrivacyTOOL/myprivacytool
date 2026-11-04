#!/usr/bin/env python3
"""Validate the Alice master asset library (MPC-7797).

    python3 tools/alice-library/validate_library.py [--library assets/alice] [--strict]

Exit 0 only when the library is complete and consistent. A draft library (locked=false) reports
what is missing and exits 1 with --strict, 0 otherwise, so CI can run it without blocking drafts.
Locked libraries are always strict: every required asset must be present, checksummed and unchanged.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import struct
import sys
from pathlib import Path

SPECS = ["character-sheet.md", "animation-production.md", "voice.md", "validation-checklist.md"]
STATUSES = {"missing", "present", "locked", "reference-only"}
KINDS = {"face", "pose", "expression", "animation-source", "animation", "voice", "interim-reference"}


def png_size(path: Path) -> tuple[int, int] | None:
    with path.open("rb") as f:
        head = f.read(24)
    if head[:8] != b"\x89PNG\r\n\x1a\n" or head[12:16] != b"IHDR":
        return None
    return struct.unpack(">II", head[16:24])


def sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def validate(lib: Path) -> tuple[list[str], list[str]]:
    """Return (errors, missing). Errors are real defects; missing is work still to do."""
    errors: list[str] = []
    missing: list[str] = []
    mp = lib / "manifest.json"
    if not mp.exists():
        return [f"{mp} not found"], []
    try:
        m = json.loads(mp.read_text())
    except json.JSONDecodeError as e:
        return [f"manifest.json is not valid JSON: {e}"], []

    locked = bool(m.get("locked"))
    version = str(m.get("version", ""))
    if locked and "draft" in version:
        errors.append(f"version {version!r} is a draft but locked=true")
    if locked and m.get("fps") != 30:
        errors.append("fps must be 30")
    if locked and not m.get("provenance"):
        errors.append("provenance of the master artwork must be recorded before locking")
    if locked and m.get("proportions", {}).get("status") != "measured":
        errors.append("proportions must be status 'measured' before locking")

    for spec in SPECS:
        if not (lib / "spec" / spec).exists():
            errors.append(f"missing spec/{spec}")

    seen: set[str] = set()
    for a in m.get("assets", []):
        aid = a.get("id", "?")
        if aid in seen:
            errors.append(f"duplicate asset id {aid}")
        seen.add(aid)
        if a.get("status") not in STATUSES:
            errors.append(f"{aid}: bad status {a.get('status')!r}")
            continue
        if a.get("kind") not in KINDS:
            errors.append(f"{aid}: bad kind {a.get('kind')!r}")
        path = (lib / a.get("path", "")).resolve()
        exists = path.is_file()
        status = a["status"]
        if status == "missing":
            if exists:
                errors.append(f"{aid}: file exists but status is 'missing'")
            elif a.get("required"):
                missing.append(aid)
            continue
        if not exists:
            errors.append(f"{aid}: status {status!r} but {a.get('path')} not found")
            continue
        if path.suffix == ".png":
            size = png_size(path)
            if size is None:
                errors.append(f"{aid}: not a valid PNG")
            elif status in ("present", "locked") and a.get("min_long_edge_px") and max(size) < a["min_long_edge_px"]:
                errors.append(f"{aid}: {size[0]}x{size[1]} is below the {a['min_long_edge_px']} px long-edge minimum")
        if status == "locked":
            want = a.get("sha256")
            if not want:
                errors.append(f"{aid}: locked but no sha256 recorded")
            elif sha256(path) != want:
                errors.append(f"{aid}: locked file changed (checksum mismatch); add a new version instead")
        elif locked and a.get("required"):
            errors.append(f"{aid}: library is locked but asset is {status!r}, not 'locked'")

    if locked and missing:
        errors.append(f"library is locked but {len(missing)} required assets are missing")
    return errors, missing


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--library", type=Path, default=Path(__file__).resolve().parents[2] / "assets" / "alice")
    ap.add_argument("--strict", action="store_true", help="also fail while required assets are missing")
    args = ap.parse_args()
    errors, missing = validate(args.library)
    for e in errors:
        print(f"ERROR   {e}")
    if missing:
        print(f"MISSING {len(missing)} required assets: {', '.join(missing)}")
    if not errors and not missing:
        print("OK: library complete")
    return 1 if errors or (args.strict and missing) else 0


if __name__ == "__main__":
    sys.exit(main())
