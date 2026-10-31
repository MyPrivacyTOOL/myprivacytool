# The brand curtain: one drawing, used everywhere

A white, line-drawn curtain that opens from the middle and bunches at the sides, revealing what is behind
it (black, then Matrix Green code, per `assets/alice/spec/animation-production.md` 4a). It is built **once**
and reused on the website, in video and in newsletters, so it always has the same folds and the same speed.

Why it is built this way: the curtain is a pure function of progress. `curtainSvg(t, opts)` takes `t` from
0 (closed) to 1 (open) and returns an SVG. No clock, no DOM, a fixed random seed. The website animates `t`
in the browser; the video tool steps `t` frame by frame. Same function, same pictures.

## Where things live

| Path | What |
|---|---|
| `public/curtain/curtain-core.js` | The drawing function and brand settings (`BRAND`). Pure; also runs in Node. |
| `public/curtain/curtain-element.js` | `<mpt-curtain>`: drop-in web component for any page. |
| `public/curtain/demo.html` | Preview and scrub it: `/curtain/demo.html` (noindex, not linked). |
| `tools/curtain/render.mjs` | Exports video, transparent video, PNG frames and a newsletter GIF. |
| `scripts/ci/curtain.vitest.mjs` | Tests that pin the brand rules. Run by `npm test`. |

## Brand rules (do not change per use)

- White paper, black ink, nothing else. Reveal takes 0.5 to 1.5 s (default 1.2 s), eased.
- Same folds every time: the `seed` (7), fold look and easing live in `BRAND` / `curtain-core.js`. Changing them
  changes every place the curtain appears, so do it on purpose and re-export the videos.
- Size and frame rate may change; the look must not. The tests fail if a colour other than black or white appears.

## On a web page

```html
<script type="module" src="/curtain/curtain-element.js"></script>
<mpt-curtain trigger="visible" duration="1200">
  ...anything the curtain reveals...
</mpt-curtain>
```

| Attribute | Meaning |
|---|---|
| `trigger` | `load` (default), `visible` (when scrolled into view), `click`, `manual` |
| `duration`, `delay` | milliseconds (default 1200, 0) |
| `seed`, `folds`, `gather-pct` | override the look. Leave unset for the brand curtain. |

Methods and events: `el.play()` returns a promise, `el.reset()`, `el.progress` (0 to 1, settable),
and a `curtain-open` event when fully open. The content behind the curtain stays in the page and readable; the
curtain is decorative (`aria-hidden`). Visitors who prefer reduced motion get the open state immediately.

The Telegram page (`public/telegram-security-check.html`) uses the core function directly so the headline
words can rise as the curtain parts; it keeps a failsafe so the page is readable even if the script cannot load.

## In video, and as a transparent overlay

```bash
# transparent: WebM (alpha), ProRes 4444 (alpha) and a PNG sequence, for editors and for layering over footage
npm run curtain:render -- --out out/curtain --name curtain-alpha --w 1920 --h 1080 --formats png,webm,mov

# finished clip over the brand green code (or --backdrop black)
npm run curtain:render -- --out out/curtain --name curtain-code --w 1920 --h 1080 --backdrop code --formats mp4
```

Needs `ffmpeg` and Playwright's Chromium. Defaults: 30 fps, 0.4 s closed, 1.2 s opening, 0.6 s held open
(`--hold-start`, `--ms`, `--hold-end`). MP4 has no transparency, so it needs a backdrop. Use the WebM or MOV
when you want to drop the curtain over other footage. WebM alpha is read by Chrome and Firefox; Safari needs the
MOV or the PNG sequence.

## In a newsletter

Email clients do not run CSS or JavaScript animation, so use an animated GIF:

```bash
npm run curtain:render -- --out out/curtain --name curtain-newsletter --w 1280 --h 720 \
  --backdrop code --hold-start 300 --hold-end 700 --formats gif
```

The GIF is 480 px wide, 12 fps, 32 colours, about 0.8 MB, and **plays once then rests on the open frame**.
Tune with `--gif-width`, `--gif-fps`, `--gif-colors`; keep it under about 1 MB.

Rules for email:
- **Outlook for Windows shows only the first frame.** Frame 1 is the closed curtain, so never put the message
  only inside the GIF. Keep the headline and the button as live HTML text beside it.
- Give the image `alt` text that says what is revealed, set `width`/`height`, and host it on a stable URL.
- If the GIF is blocked, the alt text and the live text still carry the message.

## Changing the curtain

1. Edit `curtain-core.js` (`BRAND` for settings, `panel()` for the drawing).
2. Run `node scripts/ci/curtain.vitest.mjs` through `npx vitest run scripts/ci/curtain.vitest.mjs`.
3. Look at it: open `/curtain/demo.html` and scrub, or render a strip of frames.
4. Re-export any videos and GIFs that use it. Cloudflare keeps `.js` in visitors' browsers for about 4 hours whatever `_headers` says, so when a curtain script changes, bump the `?v=` on its `<script>`/`import` line in every page that loads it (`public/telegram-security-check.html`, `public/curtain/demo.html`).

## Known limits

- The Telegram check page no longer uses the procedural curtain; it plays the Alice clip and draws it back with the pleat module (below). The procedural curtain stays for video and newsletter exports.
- The folds are drawn procedurally in the engraving style. They are not a trace of the Alice curtain art, and Alice
  is not in this component. The layered Alice art (`assets/alice/animations/alice_p6_layers_v0/`) can be stacked
  behind or in front of it later; that is a design decision, not a code change.
- Opening is left and right from the centre. Other directions (one side, up) are not built.
- The `/footprint/` page has its own older curtain (`docs/footprint-curtain.md`); it has not been moved to this one.

## The Alice pull-back (Telegram check page)

`public/curtain/curtain-pleat.js` draws the Alice picture or clip back like cloth. `createPleat(canvas, {source, side})` splits
the source into strips and folds them in CSS 3D; the page repaints the video into the strips every frame, so the clip keeps
playing while it is drawn back. `pleatFrame(t, opts)` is the pure maths (tested). Settings are in `PLEAT` (gather width 7%,
perspective, fold shading). Timing lives in the page: `PULL_AT` (3.9 s into the clip) and `GATHER_MS` (1300).
Fallbacks open the page at once: autoplay blocked, video error, no start in 3.5 s, tap, reduced motion, and an 8 s failsafe.
