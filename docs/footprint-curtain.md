# /footprint/ curtain: how to change the Alice image, video, size and timing

The curtain on `/footprint/` (`public/footprint/index.html`) reads its settings from
`public/footprint/curtain.json`. Change the file, deploy, done. No code change.

If the file is missing or a value is invalid, the page falls back to built-in defaults that match the
file (bad numbers are clamped, unknown options are ignored).

## Settings

| Key | What it does | Default |
|---|---|---|
| `image` | Picture shown while the curtain is closed. Path relative to `/footprint/` (or `/media/...`). Empty hides it. | `alice-curtain.jpg?v=2` |
| `imageAlt` | Alt text for the picture (also the video's label). | Alice drawing back a curtain... |
| `video` | Optional video. When set, the picture is replaced by the video when the visitor taps the button; the curtain opens when it ends. Empty = no video. Skipped for visitors who prefer reduced motion. | empty |
| `videoPoster` | Still frame shown before the video plays. Falls back to `image`. | empty |
| `videoMaxSeconds` | Longest the video may play (1-60). The curtain opens at this point even if the video is longer or fails to play. | 8 |
| `buttonLabel` | Text on the green button. | Open the curtain |
| `maxWidthPct` / `maxHeightPct` | Largest size of the picture or video inside the board, in percent (20-100). | 88 / 78 |
| `fit` | `contain` (whole picture visible) or `cover` (fill the space, may crop). | contain |
| `background` | Colour behind the picture (`#ffffff`, or a plain colour name). | `#ffffff` |
| `slide` | How the curtain leaves: `left`, `right`, `up` or `fade`. | left |
| `openMs` | Length of that exit animation in milliseconds (0-6000). | 1300 |
| `zoomDelayMs` | Pause after it opens before the view zooms in on the hexagons (0-20000). | 2900 |

## Swapping the picture

1. Put the new file in `public/footprint/` (for example `alice-new.jpg`) and set `"image": "alice-new.jpg"`.
2. If you reuse the **same file name**, change the `?v=` number (`alice-curtain.jpg?v=3`). Cloudflare caches
   images for a day, and a new query string forces a fresh copy.
3. Keep the picture on a white background, or set `background` to match its edge colour.

## Using a video

There is already a 6-second, 560x560 clip of Alice opening the curtain at `/media/alice-curtain.mp4`.
To use it:

```json
"video": "/media/alice-curtain.mp4",
"videoPoster": "alice-curtain.jpg?v=2",
"videoMaxSeconds": 7
```

Tips: use H.264 MP4, keep it small (it is downloaded on tap, not on page load: `preload="none"`), make it
square or match `maxWidthPct`/`maxHeightPct`, and keep it muted (the page plays it muted so phones allow
autoplay).

## Caching

`public/_headers` makes `/footprint/` and `/footprint/curtain.json` revalidate on every visit, so a changed
`curtain.json` shows up right after the deploy.
