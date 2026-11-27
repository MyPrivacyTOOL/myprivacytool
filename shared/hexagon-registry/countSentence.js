// MPC-9832: the ONE sentence that states the hexagon count, used by /, /blog, /hexagon/ and /how-we-calculate-your-score.
// The number comes from the registry (web scan), never typed by hand.
// MPC-11541 (Chris, 2026-11-27): no headline catalogue total anywhere in site copy. The catalogue is published in full on /footprint/ with a status badge on every tile, so the
// sentence states only what the scan runs.
import { HEXAGON_COUNT } from './registry.js';

export const countSentence = (web = HEXAGON_COUNT) => `${web} run in the scan`;
