import type { PathMark } from '@/components/InteractiveHexagonTile';

/** The footprints path, when switched on: the ids answered so far, in order, and the next one to answer. */
export interface PathInput {
  steps: readonly string[];
  nextId: string | null;
}

/** How one tile looks on the path. Nothing is faded until the first step is taken. */
export function pathMark(path: PathInput | undefined, id: string): PathMark | undefined {
  if (!path || path.steps.length === 0) return undefined;
  const i = path.steps.indexOf(id);
  if (i >= 0) return { state: i === path.steps.length - 1 ? 'here' : 'on', step: i + 1 };
  return { state: id === path.nextId ? 'next' : 'faint' };
}
