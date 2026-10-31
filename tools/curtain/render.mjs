#!/usr/bin/env node
// render.mjs: export the brand curtain as video, GIF or PNG frames. Same drawing as the website
// (public/curtain/curtain-core.js), so a video, a newsletter GIF and the page always match.
//
//   node tools/curtain/render.mjs --out out/curtain --name curtain-open
//        [--w 1920 --h 1080] [--fps 30] [--ms 1200] [--hold-start 400] [--hold-end 600]
//        [--backdrop none|black|code]      none = transparent (needed for webm/mov alpha)
//        [--formats png,webm,mov,mp4,gif]
//
//   png   transparent PNG sequence (for an editor; spec 4a lists this as a delivery format)
//   webm  VP9 with alpha: drop over any footage or page background
//   mov   ProRes 4444 with alpha: for video editors (large)
//   mp4   H.264, no alpha: needs --backdrop black or code
//   gif   for newsletters (email clients do not run CSS or JS animation); backdrop baked in, plays once.
//         extra flags: --gif-width 480 --gif-fps 12 --gif-colors 32
//
// Needs: ffmpeg on PATH, and playwright (chromium). Brand look and timing come from BRAND; flags only
// change size and frame rate, so every export keeps the same folds and speed.
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { curtainSvg, BRAND, clamp01 } from '../../public/curtain/curtain-core.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CODE_PNG = path.resolve(HERE, '../../assets/alice/animations/alice_p6_layers_v0/code.png');

function arg(name, dflt) {
  const i = process.argv.indexOf('--' + name);
  return i > -1 && process.argv[i + 1] && !process.argv[i + 1].startsWith('--') ? process.argv[i + 1] : dflt;
}
export function frameTimes({ fps, ms, holdStart, holdEnd }) {
  const nOpen = Math.max(2, Math.round((ms / 1000) * fps));
  const a = Math.round((holdStart / 1000) * fps), b = Math.round((holdEnd / 1000) * fps);
  const ts = [];
  for (let i = 0; i < a; i++) ts.push(0);
  for (let i = 0; i <= nOpen; i++) ts.push(clamp01(i / nOpen));
  for (let i = 0; i < b; i++) ts.push(1);
  return ts;
}

async function loadChromium() {
  const req = createRequire(import.meta.url);
  for (const name of ['playwright', '@playwright/test']) { try { return req(name).chromium; } catch {} }
  throw new Error('playwright is not installed (npm i -D @playwright/test, or use the global one)');
}
function ff(args) {
  const r = spawnSync('ffmpeg', ['-y', '-loglevel', 'error', ...args], { stdio: 'inherit' });
  if (r.status !== 0) throw new Error('ffmpeg failed: ' + args.join(' '));
}

async function main() {
  const out = path.resolve(arg('out', 'out/curtain')), name = arg('name', 'curtain-open');
  const W = +arg('w', 1920), H = +arg('h', 1080), fps = +arg('fps', 30), ms = +arg('ms', BRAND.durationMs);
  const holdStart = +arg('hold-start', 400), holdEnd = +arg('hold-end', 600);
  const backdrop = arg('backdrop', 'none');
  const formats = arg('formats', 'png,webm').split(',').map((s) => s.trim());
  if (formats.includes('mp4') && backdrop === 'none') throw new Error('mp4 has no alpha: use --backdrop black or code');
  if (backdrop === 'code' && !fs.existsSync(CODE_PNG)) throw new Error('code backdrop not found: ' + CODE_PNG);
  const frames = path.join(out, name + '-frames');
  fs.rmSync(frames, { recursive: true, force: true }); fs.mkdirSync(frames, { recursive: true });

  const ts = frameTimes({ fps, ms, holdStart, holdEnd });
  const chromium = await loadChromium();
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: W, height: H } });
  await page.setContent('<body style="margin:0;background:transparent"></body>');
  for (let i = 0; i < ts.length; i++) {
    await page.evaluate((svg) => { document.body.innerHTML = svg; }, curtainSvg(ts[i], { width: W, height: H }));
    await page.screenshot({ path: path.join(frames, String(i).padStart(4, '0') + '.png'), omitBackground: true });
  }
  await browser.close();
  console.log(`[curtain] ${ts.length} frames at ${W}x${H}, ${fps} fps -> ${frames}`);

  const inFrames = ['-framerate', String(fps), '-i', path.join(frames, '%04d.png')];
  const bgInput = backdrop === 'code' ? ['-loop', '1', '-i', CODE_PNG]
                : backdrop === 'black' ? ['-f', 'lavfi', '-i', `color=c=black:s=${W}x${H}`] : null;
  const bgFilter = backdrop === 'code' ? `[0:v]scale=${W}:${H}:force_original_aspect_ratio=increase,crop=${W}:${H},setsar=1[bg]`
                : backdrop === 'black' ? '[0:v]setsar=1[bg]' : null;
  const withBg = (tail) => bgInput
    ? [...bgInput, ...inFrames, '-filter_complex', `${bgFilter};[bg][1:v]overlay=shortest=1,format=${tail}`]
    : [...inFrames, '-vf', `format=${tail}`];

  if (formats.includes('webm')) {
    const f = path.join(out, name + '.webm');
    ff([...inFrames, '-c:v', 'libvpx-vp9', '-pix_fmt', 'yuva420p', '-auto-alt-ref', '0', '-b:v', '0', '-crf', '28', f]);
    console.log('[curtain] wrote ' + f + (backdrop === 'none' ? ' (alpha)' : ' (backdrop baked in: use --backdrop none for alpha)'));
  }
  if (formats.includes('mov')) {
    const f = path.join(out, name + '.mov');
    ff([...inFrames, '-c:v', 'prores_ks', '-profile:v', '4444', '-pix_fmt', 'yuva444p10le', f]);
    console.log('[curtain] wrote ' + f);
  }
  if (formats.includes('mp4')) {
    const f = path.join(out, name + '.mp4');
    ff([...withBg('yuv420p'), '-c:v', 'libx264', '-crf', '18', '-movflags', '+faststart', '-r', String(fps), f]);
    console.log('[curtain] wrote ' + f);
  }
  if (formats.includes('gif')) {
    // Newsletter defaults are small on purpose (Gmail clips big messages; many clients cap GIFs ~1 MB).
    // Plays once and rests on the open frame. Outlook for Windows shows only frame 1, so never put
    // the message only inside the GIF: keep the headline and button as live HTML text next to it.
    const f = path.join(out, name + '.gif'), gw = Math.min(W, +arg('gif-width', 480));
    const gfps = Math.min(fps, +arg('gif-fps', 12)), gcol = +arg('gif-colors', 32);
    const base = bgInput ? [...bgInput, ...inFrames] : ['-f', 'lavfi', '-i', `color=c=black:s=${W}x${H}`, ...inFrames];
    const bg = bgInput ? bgFilter : '[0:v]setsar=1[bg]';
    ff([...base, '-filter_complex',
      `${bg};[bg][1:v]overlay=shortest=1,fps=${gfps},scale=${gw}:-1:flags=lanczos,split[a][b];[a]palettegen=max_colors=${gcol}[p];[b][p]paletteuse=dither=bayer:bayer_scale=5`,
      '-loop', '-1', f]);
    console.log(`[curtain] wrote ${f} (${Math.round(fs.statSync(f).size / 1024)} KB; keep newsletter GIFs under ~1 MB)`);
  }
  if (!formats.includes('png')) fs.rmSync(frames, { recursive: true, force: true });
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch((e) => { console.error('[curtain] ' + e.message); process.exit(1); });
