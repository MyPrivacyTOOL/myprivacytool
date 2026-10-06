import { useEffect, useRef } from 'react';
import { afterFirstPaint } from '@/lib/idle';

/**
 * Site-wide Matrix rain (MPC-6906).
 *
 * One fixed, full-viewport, transparent canvas mounted once in <Layout>. It sits
 * behind all content (z-0, pointer-events-none) so it reads as a continuous
 * texture behind hero, newsletter, contact form and footer with no colour seam.
 * The page background (--matrix-bg) provides the white; the canvas only draws
 * glyphs and is fully cleared every frame (no fade-residue on a light ground).
 *
 * Colours/opacities come from the CSS tokens in index.css. Single rAF loop,
 * throttled to ~20fps, paused when the tab is hidden, static under
 * prefers-reduced-motion.
 */

const CHARS =
  'アイウエオカキクケコサシスセソタチツテトナニヌネノハヒフヘホマミムメモヤユヨラリルレロワヲン0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ';
const FONT_SIZE = 16;
const STEP_MS = 50;
const TRAIL = 14;
const MAX_DPR = 2;

const readToken = (name: string, fallback: string) => {
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return v || fallback;
};

interface Column {
  head: number; // row index of the leading glyph
  glyphs: string[]; // glyph per trail cell, index 0 = leader
}

const randomGlyph = () => CHARS[Math.floor(Math.random() * CHARS.length)];

const MatrixRain = () => {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;

    const motionQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
    let reduced = motionQuery.matches;

    let width = 0;
    let height = 0;
    let rows = 0;
    let columns: Column[] = [];
    let rafId = 0;
    let lastStep = 0;
    let ready = false;

    let glyph = '';
    let lead = '';
    let glyphAlpha = 0.18;
    let leadAlpha = 0.32;

    const loadTokens = () => {
      glyph = `hsl(${readToken('--matrix-glyph', '146 85% 29%')})`;
      lead = `hsl(${readToken('--matrix-lead', '143 100% 24%')})`;
      glyphAlpha = parseFloat(readToken('--matrix-glyph-alpha', '0.18'));
      leadAlpha = parseFloat(readToken('--matrix-lead-alpha', '0.32'));
    };

    const newColumn = (scatter: boolean): Column => ({
      head: scatter ? Math.floor(Math.random() * (rows + TRAIL)) : -Math.floor(Math.random() * rows * 0.6),
      glyphs: Array.from({ length: TRAIL }, randomGlyph),
    });

    const resize = () => {
      const w = window.innerWidth;
      const h = window.innerHeight;
      // Ignore small height changes (mobile URL bar) so we don't reallocate mid-scroll.
      if (w === width && Math.abs(h - height) < 120 && canvas.width > 0) return;
      // Phones: 1x is plenty for 18-32% alpha glyphs and quarters the pixels to fill.
      const dpr = Math.min(window.devicePixelRatio || 1, w < 768 ? 1 : MAX_DPR);
      width = w;
      height = h;
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.font = `${FONT_SIZE}px monospace`;
      ctx.textBaseline = 'top';
      rows = Math.ceil(h / FONT_SIZE);
      const count = Math.ceil(w / FONT_SIZE);
      columns = Array.from({ length: count }, () => newColumn(true));
      draw();
    };

    const draw = () => {
      ctx.clearRect(0, 0, width, height);
      // Fill style/alpha depend only on the trail index, so iterate trail-major and change canvas state
      // TRAIL times per frame instead of once per glyph (same pixels, far less state churn).
      for (let t = 0; t < TRAIL; t++) {
        if (t === 0) {
          ctx.fillStyle = lead;
          ctx.globalAlpha = leadAlpha;
        } else {
          ctx.fillStyle = glyph;
          ctx.globalAlpha = glyphAlpha * (1 - t / TRAIL);
        }
        for (let c = 0; c < columns.length; c++) {
          const col = columns[c];
          const row = col.head - t;
          if (row < 0 || row > rows) continue;
          ctx.fillText(col.glyphs[t], c * FONT_SIZE, row * FONT_SIZE);
        }
      }
      ctx.globalAlpha = 1;
    };

    const step = () => {
      for (const col of columns) {
        col.head++;
        col.glyphs.unshift(randomGlyph());
        col.glyphs.length = TRAIL;
        if (col.head - TRAIL > rows && Math.random() > 0.975) col.head = 0;
      }
    };

    const tick = (now: number) => {
      rafId = requestAnimationFrame(tick);
      if (now - lastStep < STEP_MS) return;
      lastStep = now;
      step();
      draw();
    };

    const start = () => {
      if (!ready || reduced || rafId || document.hidden) return;
      lastStep = 0;
      rafId = requestAnimationFrame(tick);
    };
    const stop = () => {
      cancelAnimationFrame(rafId);
      rafId = 0;
    };

    const onVisibility = () => (document.hidden ? stop() : start());
    const onMotion = (e: MediaQueryListEvent) => {
      reduced = e.matches;
      if (reduced) {
        stop();
        draw(); // static frame
      } else {
        start();
      }
    };

    // MPC-7200: decorative layer starts after the first paint so it never competes with LCP/INP.
    let cancelled = false;
    afterFirstPaint().then(() => {
      if (cancelled) return;
      ready = true;
      loadTokens();
      resize();
      start();
    });
    const onResize = () => ready && resize();
    window.addEventListener('resize', onResize);
    document.addEventListener('visibilitychange', onVisibility);
    motionQuery.addEventListener('change', onMotion);

    return () => {
      cancelled = true;
      stop();
      window.removeEventListener('resize', onResize);
      document.removeEventListener('visibilitychange', onVisibility);
      motionQuery.removeEventListener('change', onMotion);
    };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      aria-hidden="true"
      className="pointer-events-none fixed inset-0 z-0 h-full w-full"
    />
  );
};

export default MatrixRain;
