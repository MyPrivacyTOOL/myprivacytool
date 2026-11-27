export type TileState = 'live' | 'in_build' | 'planned';
export const TILE_LABEL: Record<TileState, string>;
export function tileState(item: { id: string; status?: string }): TileState;
