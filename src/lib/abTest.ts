// Lightweight client-side A/B testing (MPC-7400). No third-party library, no cookies, no stored identifier.
//
// How it works
//  - Experiments are declared in EXPERIMENTS below. The first variant is always the control.
//  - A visitor's variant is picked once per browser tab session (sessionStorage) so the UI does not flip
//    on re-render or navigation. sessionStorage is cleared when the tab closes, so nothing identifies
//    a person across visits. If storage is unavailable the pick simply lasts for the page view.
//  - An experiment ships switched off (everyone sees the control) until its VITE_AB_<ID>_ENABLED flag is
//    "true" at build time. This keeps unapproved copy off the live site (copy needs Chris's approval).
//  - QA override: append ?ab_<experiment_id>=<variant_id> to the URL to force a variant (works even when the
//    experiment is switched off, never stored, never counted as an organic pick).
//  - Exposure and conversion events go to GA4 through src/lib/analytics.ts (consent-gated like all events).
//
// Docs: docs/ab-testing.md

export interface Variant {
  id: string;
  /** Relative traffic share. Only the ratios matter. */
  weight: number;
}

export interface Experiment {
  id: string;
  description: string;
  enabled: boolean;
  variants: readonly [Variant, ...Variant[]];
}

export const EXPERIMENTS = {
  // Primary submit button of the /start email form. Copy is truthful for what the form does today:
  // it joins a list, it does not run a scan.
  start_cta: {
    id: "start_cta",
    description: "Submit-button copy on /start",
    enabled: import.meta.env.VITE_AB_START_CTA_ENABLED === "true",
    variants: [
      { id: "control", weight: 50 }, // "Check My Exposure"
      { id: "early_access", weight: 50 }, // "Get early access, free"
    ],
  },
} as const satisfies Record<string, Experiment>;

export type ExperimentId = keyof typeof EXPERIMENTS;

const STORAGE_PREFIX = "mpt_ab_";

/** Weighted pick. `rand` must be in [0, 1). Exported for tests. */
export function pickVariant(variants: readonly Variant[], rand: number): string {
  const total = variants.reduce((sum, v) => sum + Math.max(v.weight, 0), 0);
  if (total <= 0) return variants[0].id;
  let threshold = rand * total;
  for (const v of variants) {
    threshold -= Math.max(v.weight, 0);
    if (threshold < 0) return v.id;
  }
  return variants[variants.length - 1].id;
}

const secureRandom = (): number => {
  try {
    const buf = new Uint32Array(1);
    crypto.getRandomValues(buf);
    return buf[0] / 2 ** 32;
  } catch {
    return Math.random();
  }
};

const readStorage = (key: string): string | null => {
  try {
    return window.sessionStorage.getItem(key);
  } catch {
    return null;
  }
};

const writeStorage = (key: string, value: string): void => {
  try {
    window.sessionStorage.setItem(key, value);
  } catch {
    /* storage blocked: the pick lasts for this page view only */
  }
};

export interface Assignment {
  experimentId: string;
  variantId: string;
  /** True when the variant was forced with ?ab_<id>=<variant> (exclude from results). */
  forced: boolean;
  /** True when the experiment is live and the visitor was bucketed. */
  active: boolean;
}

export function getAssignment(experiment: Experiment, search: string = window.location.search): Assignment {
  const control = experiment.variants[0].id;
  const forcedId = new URLSearchParams(search).get(`ab_${experiment.id}`);
  if (forcedId && experiment.variants.some((v) => v.id === forcedId)) {
    return { experimentId: experiment.id, variantId: forcedId, forced: true, active: false };
  }
  if (!experiment.enabled) {
    return { experimentId: experiment.id, variantId: control, forced: false, active: false };
  }
  const key = `${STORAGE_PREFIX}${experiment.id}`;
  const stored = readStorage(key);
  if (stored && experiment.variants.some((v) => v.id === stored)) {
    return { experimentId: experiment.id, variantId: stored, forced: false, active: true };
  }
  const picked = pickVariant(experiment.variants, secureRandom());
  writeStorage(key, picked);
  return { experimentId: experiment.id, variantId: picked, forced: false, active: true };
}
