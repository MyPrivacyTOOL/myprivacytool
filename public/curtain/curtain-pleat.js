// curtain-pleat.js: draw a PICTURE (or a playing video) back like a pleated curtain.
//
// The picture is the cloth. It is cut into vertical strips that fold like a concertina and gather at one
// side while the picture keeps playing on them, so a still of Alice, or a clip of Alice pushing the curtain,
// is itself the curtain that is drawn back. Used by public/telegram-security-check.html; reusable for any
// picture or video (docs/curtain.md).
//
//   const p = createPleat(hostEl, { source: videoOrImg, side: 'right' });
//   p.render();            // paint the source's current frame onto the strips (call each frame for video)
//   p.setProgress(0..1);   // 0 = flat picture, 1 = gathered into a narrow bundle at the side
//   p.destroy();
//
// pleatFrame() is the pure geometry (no DOM) so the fold maths is unit-tested.

export const PLEAT = Object.freeze({ gatherPct: 7, perspective: 1500, darkOdd: 0.9, darkEven: 0.55 });

export function easeInOut(t) {
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

// Geometry for strip i of n at progress t. Strips hinge at shared edges and alternate their fold direction,
// so adjacent strips always meet edge to edge (a continuous cloth). Width of the gathered bundle = gatherPct% of width.
export function pleatFrame(t, { n, width, side = 'right', gatherPct = PLEAT.gatherPct }) {
  const w = width / n, g = gatherPct / 100;
  const c = 1 + (g - 1) * easeInOut(t);            // cos(theta): 1 flat ... g folded
  const theta = Math.acos(Math.max(0, Math.min(1, c)));
  const s = Math.sin(theta);
  const strips = [];
  for (let i = 0; i < n; i++) {
    const odd = i % 2 === 1;
    const x = side === 'right' ? width - (n - i) * w * c : i * w * c;
    strips.push({
      i, x, z: odd ? -w * s : 0,
      deg: (odd ? -1 : 1) * theta * 180 / Math.PI,
      dark: (odd ? PLEAT.darkOdd : PLEAT.darkEven) * s,
    });
  }
  return { w, c, theta, strips, bundleLeft: strips[0].x, bundleWidth: side === 'right' ? width - strips[0].x : strips[n - 1].x + w * c };
}

// Where a strip's right edge lands in 3D (for the continuity check).
export function stripRightEdge(frame, i) {
  const st = frame.strips[i], sign = i % 2 === 1 ? -1 : 1;
  return { x: st.x + frame.w * Math.cos(frame.theta), z: st.z - sign * frame.w * Math.sin(frame.theta) };
}

export function createPleat(host, opts = {}) {
  const side = opts.side || 'right', paper = opts.paper || '#ffffff', maxH = opts.maxHeight || 300;
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const W = Math.max(40, Math.round(host.clientWidth || host.getBoundingClientRect().width));
  const H = Math.max(40, Math.round(host.clientHeight || host.getBoundingClientRect().height));
  const n = opts.strips || Math.max(8, Math.min(18, Math.round(W / 80)));
  const src = opts.source;

  const root = document.createElement('div');
  root.className = 'mpt-pleat';
  root.style.cssText = `position:absolute;inset:0;overflow:hidden;perspective:${PLEAT.perspective}px;perspective-origin:${side === 'right' ? '100%' : '0%'} 50%;pointer-events:none`;
  const comp = document.createElement('canvas');           // the flat picture, repainted each frame
  comp.width = Math.round(W * dpr); comp.height = Math.round(H * dpr);
  const cctx = comp.getContext('2d');

  const sw = Math.ceil(W / n) + 1;                           // 1px overlap hides seams at rest
  const strips = [];
  for (let i = 0; i < n; i++) {
    const el = document.createElement('div');
    el.style.cssText = `position:absolute;left:0;top:0;width:${sw}px;height:${H}px;transform-origin:0 50%;will-change:transform`;
    const cv = document.createElement('canvas');
    cv.width = Math.round(sw * dpr); cv.height = Math.round(H * dpr);
    cv.style.cssText = `display:block;width:${sw}px;height:${H}px`;
    // Soft shading across each fold: a fold that turns toward the light is darkest at its far edge, one that turns
    // away is darkest at its hinge. Fades in as the fold deepens, so a flat picture is never shaded.
    const shade = document.createElement('div');
    shade.style.cssText = 'position:absolute;inset:0;opacity:0;background:' + (i % 2 === 1
      ? 'linear-gradient(90deg,rgba(0,0,0,.42),rgba(0,0,0,0) 85%)'
      : 'linear-gradient(90deg,rgba(0,0,0,0) 15%,rgba(0,0,0,.26))');
    el.appendChild(cv); el.appendChild(shade); root.appendChild(el);
    strips.push({ el, cv, ctx: cv.getContext('2d'), shade });
  }
  const rod = document.createElement('div');
  rod.style.cssText = 'position:absolute;left:0;right:0;top:0;height:5px;background:linear-gradient(#111,#000);z-index:2';
  root.appendChild(rod);
  host.appendChild(root);

  function render() {
    cctx.fillStyle = paper; cctx.fillRect(0, 0, comp.width, comp.height);
    const nw = src.videoWidth || src.naturalWidth || src.width, nh = src.videoHeight || src.naturalHeight || src.height;
    if (nw && nh) {
      const dh = Math.min(H, maxH), dw = Math.min(W * 0.9, dh * nw / nh);
      try { cctx.drawImage(src, ((W - dw) / 2) * dpr, ((H - dh) / 2) * dpr, dw * dpr, dh * dpr); } catch (e) {}
    }
    const pxw = strips[0].cv.width;
    for (let i = 0; i < n; i++) {
      const sx = Math.round(i * (W / n) * dpr);
      strips[i].ctx.drawImage(comp, sx, 0, pxw, comp.height, 0, 0, pxw, comp.height);
    }
  }
  function setProgress(t) {
    const f = pleatFrame(t, { n, width: W, side });
    for (let i = 0; i < n; i++) {
      const s = f.strips[i];
      strips[i].el.style.transform = `translate3d(${s.x.toFixed(2)}px,0,${s.z.toFixed(2)}px) rotateY(${s.deg.toFixed(2)}deg)`;
      strips[i].shade.style.opacity = s.dark.toFixed(3);
    }
    rod.style.opacity = t > 0.92 ? String(Math.max(0, (1 - t) / 0.08)) : '1';
  }
  render(); setProgress(0);
  return { render, setProgress, el: root, n, destroy() { root.remove(); } };
}
