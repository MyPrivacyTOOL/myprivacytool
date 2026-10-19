import json
import shutil
import subprocess
import tempfile
import unittest
from pathlib import Path

import build_short as bs

HERE = Path(__file__).parent
EXAMPLE = HERE / "examples" / "mpt-yt-s010.json"


def good(**over):
    raw = {"id": "MPT-YT-S010", "slug": "singapore-dnc-registry", "title": "T",
           "beats": [{"narration": "Hello there.", "on_screen": "Hi"}]}
    raw.update(over)
    return raw


class ParseTests(unittest.TestCase):
    def test_example_script_is_valid(self):
        s = bs.load_script(EXAMPLE)
        self.assertEqual(s.id, "mpt-yt-s010")
        self.assertEqual(len(s.beats), 7)

    def test_every_example_script_is_valid(self):
        found = sorted((HERE / "examples").glob("*.json"))
        self.assertGreaterEqual(len(found), 2)
        for f in found:
            bs.load_script(f)

    def test_rejects_bad_input(self):
        for bad in ({"id": "S010"}, good(slug="one"), good(slug="Has Caps-here"), good(beats=[]),
                    good(beats=[{"narration": ""}]), good(title="x" * 101), good(language="english")):
            with self.assertRaises(bs.ScriptError):
                bs.parse_script(bad)

    def test_output_names_follow_file_naming_convention(self):
        n = bs.output_names(bs.parse_script(good()))
        self.assertEqual(n["video"], "mpt-yt-s010_singapore-dnc-registry_en_9x16_v1.mp4")
        self.assertEqual(n["srt"], "mpt-yt-s010_singapore-dnc-registry_en.srt")
        self.assertEqual(n["thumb"], "mpt-yt-s010_singapore-dnc-registry_thumb-a.jpg")


class TimingTests(unittest.TestCase):
    def setUp(self):
        self.script = bs.load_script(EXAMPLE)
        self.samples, self.tl = bs.build_voice_track(self.script, bs.SilentVoice())

    def test_timeline_is_ordered_with_approved_pauses(self):
        tl = self.tl
        self.assertAlmostEqual(tl.starts[0], bs.LEAD_IN_S, places=2)
        for i in range(len(tl.starts) - 1):
            self.assertAlmostEqual(tl.starts[i + 1] - tl.ends[i], bs.PAUSE_S, places=2)
        self.assertAlmostEqual(tl.total - tl.ends[-1], bs.TAIL_S, places=2)

    def test_holds_lengthen_only_the_lead_in_and_tail(self):
        _, held = bs.build_voice_track(self.script, bs.SilentVoice(), hold_in=1.5, hold_out=2.0)
        self.assertAlmostEqual(held.starts[0], bs.LEAD_IN_S + 1.5, places=2)
        self.assertAlmostEqual(held.total - held.ends[-1], bs.TAIL_S + 2.0, places=2)
        self.assertAlmostEqual(held.total - self.tl.total, 3.5, places=2)
        for i in range(len(held.starts) - 1):
            self.assertAlmostEqual(held.starts[i + 1] - held.ends[i], bs.PAUSE_S, places=2)

    def test_audio_length_matches_timeline(self):
        self.assertAlmostEqual(len(self.samples) / 24000, self.tl.total, places=1)

    def test_captions_are_the_narration_word_for_word(self):
        cues = bs.make_cues(self.script, self.tl)
        said = " ".join(c.text for c in cues).split()
        wanted = " ".join(b.narration for b in self.script.beats).split()
        self.assertEqual(said, wanted)
        for c in cues:
            self.assertLessEqual(len(c.text.split()), bs.MAX_CAPTION_WORDS)
            self.assertGreater(c.end, c.start)
        for a, b in zip(cues, cues[1:]):
            self.assertLessEqual(a.end, b.start + 1e-6)

    def test_long_captions_break_at_word_boundaries_in_two_lines(self):
        text = bs._two_lines("There are three free Do-Not-Call registers, for".split())
        self.assertEqual(text, "There are three free\nDo-Not-Call registers, for")
        self.assertEqual(bs._two_lines("It is free".split()), "It is free")

    def test_srt_format(self):
        srt = bs.to_srt(bs.make_cues(self.script, self.tl))
        self.assertTrue(srt.startswith("1\n00:00:00,2"))
        self.assertEqual(bs.srt_time(3661.5), "01:01:01,500")


@unittest.skipUnless(shutil.which("ffmpeg") and bs.INTER_DIR.exists(), "needs ffmpeg and the Inter font")
class SmokeTest(unittest.TestCase):
    def test_silent_run_makes_a_1080x1920_short_with_srt_and_small_thumbnail(self):
        with tempfile.TemporaryDirectory() as out:
            script = bs.load_script(EXAMPLE)
            script.beats = script.beats[:2]  # keep the test quick
            paths = bs.build(script, bs.SilentVoice(), Path(out), alice=None)
            probe = subprocess.run(
                ["ffprobe", "-v", "error", "-select_streams", "v:0", "-show_entries",
                 "stream=width,height", "-of", "json", str(paths["video"])],
                capture_output=True, text=True, check=True)
            st = json.loads(probe.stdout)["streams"][0]
            self.assertEqual((st["width"], st["height"]), (1080, 1920))
            self.assertTrue(paths["srt"].read_text().strip())
            self.assertLess(paths["thumb"].stat().st_size, 2_000_000)

    def test_sting_with_holds_adds_exactly_the_hold_seconds(self):
        sting = HERE.parent.parent / "assets" / "branding" / "audio" / "mpt-sting_v1.0.wav"
        self.assertTrue(sting.exists(), "the approved brand sting is missing")

        def duration(path):
            out = subprocess.run(["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", str(path)],
                                 capture_output=True, text=True, check=True)
            return float(out.stdout)

        with tempfile.TemporaryDirectory() as out:
            script = bs.load_script(EXAMPLE)
            script.beats = script.beats[:2]
            plain = bs.build(script, bs.SilentVoice(), Path(out) / "a", alice=None)
            held = bs.build(script, bs.SilentVoice(), Path(out) / "b", alice=None, sting=sting, hold_in=1.5, hold_out=2.0)
            self.assertAlmostEqual(duration(held["video"]) - duration(plain["video"]), 3.5, delta=0.15)


@unittest.skipUnless(bs.INTER_DIR.exists(), "needs the Inter font")
class FrameLayoutTest(unittest.TestCase):
    def test_long_url_headline_stays_inside_the_side_margins(self):
        from PIL import Image

        beat = bs.Beat(narration="Check your exposure.", on_screen="Check your exposure: myprivacytool.io/scan")
        with tempfile.TemporaryDirectory() as out:
            png = Path(out) / "f.png"
            bs.render_frame(beat, None, png)
            im = Image.open(png).convert("L").crop((0, 200, bs.W, 620))
            xs = [x for x in range(im.width) for y in range(0, im.height, 2) if im.getpixel((x, y)) < 100]
            self.assertLessEqual(max(xs), bs.W - 60)


if __name__ == "__main__":
    unittest.main()
