# Video scripts (MPC-7415)

One JSON file per approved script. Adding or changing a file here in a pull request makes
the **Render Short** workflow build the video (MP4, `.srt`, thumbnail) and attach it to the
run as an artifact. Nothing is uploaded to YouTube: a person watches it and approves it first.

- File name: the video id in lower case, e.g. `mpt-yt-s010.json`.
- Format and the full tool: `tools/video-pipeline/README.md`.
- The narration must be the **approved script word for word**. Only claims on the approved
  claims list (MPC-7402) may appear.
- Alice's drawing is `video-scripts/assets/alice.png` (the text-free reference, 820 px wide, so
  it looks soft when enlarged). Replace it with a full-size text-free file when one exists.
  Without a file there, the render has no Alice and is a layout check only.

Alice's look, motion and voice specs live in `assets/alice/` (MPC-7797). Check
`assets/alice/spec/validation-checklist.md` before a video ships.
