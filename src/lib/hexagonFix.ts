// MPC-7916 Phase 2: the next step for a tile that needs fixing. DRAFT wording: needs Chris's review before it is switched on.
// Only the hexagons that can turn red have a step (measured findings of medium or high risk). Anything else has none yet, and
// the screen says so instead of inventing one. The real fix-step model (kinds, who may run a step, re-check) is MPC-7914.
export const FIX_COPY_IS_DRAFT = true;

export interface FixStep {
  /** One plain line: what this means for the visitor. */
  why: string;
  /** What to do, in order. */
  steps: string[];
}

const FIX_STEPS: Record<string, FixStep> = {
  'webrtc-leak': {
    why: 'Your browser can reveal your real network address to a website, even when you use a VPN.',
    steps: [
      'Turn off WebRTC address sharing in your browser settings, or add a WebRTC-blocking extension.',
      'Reload this page and look at this hexagon again.',
    ],
  },
  'canvas-fingerprint': {
    why: 'Your browser draws an image in a way that is nearly unique to your device, so sites can recognise you without cookies.',
    steps: [
      'Use a browser, or a browser setting, that blocks or randomises canvas fingerprinting.',
      'Reload this page and look at this hexagon again.',
    ],
  },
  'webgl-fingerprint': {
    why: 'Your graphics hardware gives a signature that helps sites recognise your device.',
    steps: [
      'Use a browser, or a browser setting, that hides or randomises graphics details.',
      'Reload this page and look at this hexagon again.',
    ],
  },
  'audio-fingerprint': {
    why: 'Your device handles sound in a slightly unique way that sites can use to recognise it.',
    steps: [
      'Use a browser, or a browser setting, that protects against audio fingerprinting.',
      'Reload this page and look at this hexagon again.',
    ],
  },
  // Timezone/Locale has no fix step: every browser reports it, so it is "seen" (with the browser-says tick), never red.
};

export function fixStepFor(id: string): FixStep | undefined {
  return FIX_STEPS[id];
}
