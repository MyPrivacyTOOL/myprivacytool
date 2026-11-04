import hashlib
import json
import struct
import tempfile
import unittest
import zlib
from pathlib import Path

import validate_library as v


def png(path: Path, w: int, h: int) -> None:
    def chunk(t, d):
        c = struct.pack(">I", len(d)) + t + d
        return c + struct.pack(">I", zlib.crc32(t + d))
    raw = b"".join(b"\x00" + b"\x00" * w for _ in range(h))
    path.write_bytes(b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", w, h, 8, 0, 0, 0, 0))
                     + chunk(b"IDAT", zlib.compress(raw)) + chunk(b"IEND", b""))


class Lib(unittest.TestCase):
    def make(self, manifest):
        d = Path(tempfile.mkdtemp())
        (d / "spec").mkdir()
        for s in v.SPECS:
            (d / "spec" / s).write_text("x")
        (d / "poses").mkdir()
        (d / "manifest.json").write_text(json.dumps(manifest))
        return d

    def asset(self, **kw):
        base = {"id": "pose-a", "path": "poses/a.png", "kind": "pose", "required": True, "status": "missing"}
        base.update(kw)
        return base

    def test_draft_reports_missing_not_error(self):
        d = self.make({"locked": False, "version": "0.1.0-draft", "assets": [self.asset()]})
        errors, missing = v.validate(d)
        self.assertEqual((errors, missing), ([], ["pose-a"]))

    def test_locked_checksum_mismatch(self):
        d = self.make({"locked": False, "version": "1.0.0", "assets": [self.asset(status="locked", sha256="0" * 64)]})
        png(d / "poses/a.png", 4000, 10)
        errors, _ = v.validate(d)
        self.assertTrue(any("checksum" in e for e in errors))

    def test_locked_ok_and_too_small(self):
        d = self.make({"locked": False, "version": "1.0.0", "assets": [self.asset(status="locked", min_long_edge_px=3000)]})
        p = d / "poses/a.png"
        png(p, 100, 100)
        d2 = json.loads((d / "manifest.json").read_text())
        d2["assets"][0]["sha256"] = hashlib.sha256(p.read_bytes()).hexdigest()
        (d / "manifest.json").write_text(json.dumps(d2))
        errors, _ = v.validate(d)
        self.assertTrue(any("below" in e for e in errors))
        png(p, 3200, 10)
        d2["assets"][0]["sha256"] = hashlib.sha256(p.read_bytes()).hexdigest()
        (d / "manifest.json").write_text(json.dumps(d2))
        self.assertEqual(v.validate(d), ([], []))

    def test_cannot_lock_with_missing_assets(self):
        d = self.make({"locked": True, "version": "1.0.0", "fps": 30, "provenance": "x",
                       "proportions": {"status": "measured"}, "assets": [self.asset()]})
        errors, _ = v.validate(d)
        self.assertTrue(any("locked but" in e for e in errors))

    def test_real_library_has_no_errors(self):
        errors, _ = v.validate(Path(__file__).resolve().parents[2] / "assets" / "alice")
        self.assertEqual(errors, [])


if __name__ == "__main__":
    unittest.main()
