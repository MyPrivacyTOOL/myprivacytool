// MPC-9832: the ONE sentence that states the hexagon counts, used by /, /blog, /hexagon/ and /how-we-calculate-your-score.
// Numbers come from the registry (web scan) and the catalogue, never typed by hand.
import { HEXAGON_COUNT } from './registry.js';
import { HEXAGON_CATALOGUE } from './catalogue.js';

export const countSentence = (web = HEXAGON_COUNT, catalogue = HEXAGON_CATALOGUE.length) =>
  `${web} run in the scan, ${catalogue} in the catalogue`;
