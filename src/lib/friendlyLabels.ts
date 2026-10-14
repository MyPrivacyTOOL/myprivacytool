// CK-7805: display-only friendly labels. The scan keeps the real value (the report recognises returning
// visitors by the canvas hash and decides status from the WebGL value), so these never replace `value`.
const WORDS = [
  'Amber', 'Falcon', 'Maple', 'River', 'Cedar', 'Otter', 'Coral', 'Harbor', 'Willow', 'Comet', 'Pebble', 'Meadow',
  'Lantern', 'Sparrow', 'Juniper', 'Summit', 'Ember', 'Heron', 'Clover', 'Breeze', 'Violet', 'Badger', 'Quartz', 'Thistle',
  'Marble', 'Robin', 'Hazel', 'Canyon', 'Saffron', 'Lynx', 'Birch', 'Tundra', 'Poppy', 'Walnut', 'Orchid', 'Falls',
  'Indigo', 'Plover', 'Cobalt', 'Dune', 'Fern', 'Marlin', 'Topaz', 'Glade', 'Mango', 'Raven', 'Sorrel', 'Vale',
  'Basil', 'Condor', 'Dahlia', 'Island', 'Jasper', 'Kestrel', 'Laurel', 'Mist', 'Nectar', 'Opal', 'Pine', 'Reef',
  'Sage', 'Tulip', 'Umber', 'Wren',
];

/** Same hash gives the same two-word nickname. Never reveals more than the hash itself would. */
export function nicknameFromHash(hash: string): string {
  const clean = (hash || '').replace(/[^0-9a-f]/gi, '').toLowerCase();
  if (clean.length < 4) return 'Your browser';
  const a = parseInt(clean.slice(0, 2), 16) % WORDS.length;
  const b = parseInt(clean.slice(2, 4), 16) % WORDS.length;
  return `${WORDS[a]} ${WORDS[b]}`;
}

/** Plain-words graphics family (short so it fits the hexagon), or a neutral phrase. Never returns the raw renderer string. */
export function friendlyGraphics(renderer: string): string {
  const r = (renderer || '').toLowerCase();
  if (r.includes('apple')) return 'Apple graphics';
  if (r.includes('nvidia') || r.includes('geforce')) return 'NVIDIA graphics';
  if (r.includes('radeon') || r.includes('amd')) return 'AMD graphics';
  if (r.includes('intel')) return 'Intel graphics';
  if (r.includes('adreno') || r.includes('qualcomm')) return 'Qualcomm GPU';
  if (r.includes('mali') || r.includes('arm')) return 'ARM graphics';
  return 'Your graphics';
}
