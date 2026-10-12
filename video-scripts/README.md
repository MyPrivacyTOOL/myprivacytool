# Video scripts (MPC-7415)

One JSON file per approved script. Adding or changing a file here in a pull request makes
the **Render Short** workflow build the video (MP4, `.srt`, thumbnail) and attach it to the
run as an artifact. Nothing is uploaded to YouTube: a person watches it and approves it first.

- File name: the video id in lower case, e.g. `mpt-yt-s010.json`.
- Format and the full tool: `tools/video-pipeline/README.md`.
- The narration must be the **approved script word for word**. Only claims on the approved
  claims list (MPC-7402) may appear.
- Alice's drawing goes in `video-scripts/assets/alice.png` (text-free reference). Until it
  is there, the render has no Alice and is a layout check only.
