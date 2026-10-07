import type { Listener } from "./listener";

export function buildRegistry(list: Listener[]): Map<string, Listener> {
  const map = new Map<string, Listener>();
  for (const l of list) {
    if (map.has(l.id)) throw new Error(`Duplicate listener id: ${l.id}`);
    map.set(l.id, l);
  }
  return map;
}
