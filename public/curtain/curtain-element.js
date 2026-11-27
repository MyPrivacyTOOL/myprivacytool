// <mpt-curtain>: the MyPrivacyTOOL curtain as a drop-in web component. No dependencies.
//
//   <script type="module" src="/curtain/curtain-element.js"></script>
//   <mpt-curtain duration="1200">
//     ...whatever the curtain reveals (any HTML)...
//   </mpt-curtain>
//
// Attributes
//   duration   opening time in ms (default 1200; brand range 500-1500)
//   delay      wait before opening in ms (default 0)
//   trigger    load (default) | visible (open when scrolled into view) | click | manual
//   seed, folds, gather-pct   override the look; leave unset for the brand curtain
// API       el.play() -> Promise, el.reset(), el.progress (0..1, settable: drives the drawing)
// Events    'curtain-open' fires once the curtain is fully open
// Accessibility: the curtain is decorative (aria-hidden); the content behind it stays in the page and
// readable. Visitors who prefer reduced motion get the open state at once, no animation.
import { curtainSvg, ease, clamp01, BRAND } from './curtain-core.js';

const TEMPLATE = `
<style>
  :host { display: block; position: relative; overflow: hidden; }
  .stage { position: relative; }
  .veil { position: absolute; inset: 0; pointer-events: none; }
  .veil svg { display: block; width: 100%; height: 100%; }
  :host([data-open]) .veil { display: none; }
</style>
<div class="stage"><slot></slot><div class="veil" aria-hidden="true"></div></div>`;

export class MptCurtain extends HTMLElement {
  static get observedAttributes() { return ['seed', 'folds', 'gather-pct']; }

  constructor() {
    super();
    this.attachShadow({ mode: 'open' }).innerHTML = TEMPLATE;
    this._veil = this.shadowRoot.querySelector('.veil');
    this._t = 0; this._raf = 0; this._played = false;
    this._ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(() => this._draw()) : null;
  }

  connectedCallback() {
    if (this._ro) this._ro.observe(this);
    this._draw();
    const trig = this.getAttribute('trigger') || 'load';
    if (trig === 'load') this._autoplay();
    else if (trig === 'visible' && typeof IntersectionObserver !== 'undefined') {
      this._io = new IntersectionObserver((es) => { if (es.some((e) => e.isIntersecting)) { this._io.disconnect(); this._autoplay(); } }, { threshold: 0.35 });
      this._io.observe(this);
    } else if (trig === 'click') this.addEventListener('click', () => this.play(), { once: true });
  }
  disconnectedCallback() { if (this._ro) this._ro.disconnect(); if (this._io) this._io.disconnect(); cancelAnimationFrame(this._raf); }
  attributeChangedCallback() { this._draw(); }

  get progress() { return this._t; }
  set progress(v) { this._t = clamp01(+v || 0); this._draw(); if (this._t >= 1) this._markOpen(); else this.removeAttribute('data-open'); }

  _opts() {
    const r = this.getBoundingClientRect();
    const o = { width: Math.round(r.width) || 1000, height: Math.round(r.height) || 600 };
    const seed = this.getAttribute('seed'), folds = this.getAttribute('folds'), gp = this.getAttribute('gather-pct');
    if (seed !== null) o.seed = +seed;
    if (folds !== null) o.folds = +folds;
    if (gp !== null) o.gatherPct = +gp;
    return o;
  }
  _draw() { this._veil.innerHTML = curtainSvg(this._t, this._opts()); }
  _markOpen() { if (!this.hasAttribute('data-open')) { this.setAttribute('data-open', ''); this.dispatchEvent(new CustomEvent('curtain-open', { bubbles: true })); } }

  _autoplay() { this.play(); }

  play() {
    if (this._played) return Promise.resolve();
    this._played = true;
    const reduce = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduce) { this.progress = 1; return Promise.resolve(); }
    const dur = Math.max(100, +(this.getAttribute('duration') || BRAND.durationMs));
    const delay = Math.max(0, +(this.getAttribute('delay') || 0));
    return new Promise((resolve) => {
      const start = performance.now() + delay;
      const tick = (now) => {
        const lin = clamp01((now - start) / dur);
        this._t = lin; this._draw();                 // core eases internally: geometry(t) applies ease(t)
        if (lin < 1) this._raf = requestAnimationFrame(tick); else { this._markOpen(); resolve(); }
      };
      this._raf = requestAnimationFrame(tick);
    });
  }
  reset() { cancelAnimationFrame(this._raf); this._played = false; this._t = 0; this.removeAttribute('data-open'); this._draw(); }
}

if (!customElements.get('mpt-curtain')) customElements.define('mpt-curtain', MptCurtain);
