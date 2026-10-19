import type { Hexagon } from '@/types/hexagon';

/** Secured = checked or confirmed, except a confirmed exposure the user has not fixed yet. */
export const countSecured = (hexagons: Hexagon[], fixedIds: ReadonlySet<string>) =>
  hexagons.filter((h) => {
    if (h.status === 'checked') return true;
    if (h.status !== 'confirmed') return false;
    return !h.exposure || fixedIds.has(h.id);
  }).length;
