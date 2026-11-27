export interface CatalogueChannel { key: string; code: string; label: string; group: 'Core' | 'Global social' | 'Asian' | 'Offline' }
export interface CatalogueHexagon {
  id: string;
  slug: string;
  channel: string;
  group: 'Core' | 'Global social' | 'Asian' | 'Offline';
  arrival: 'A' | 'B' | 'C' | 'D';
  risk: 'high' | 'medium' | 'low';
  label: string;
  /** MPC-11541: the Hexagon Registry row (Hexagon ID) and its Evidence Key. */
  registry_id?: number;
  evidence_key?: string;
  /** Set on rows that came from the 2026-11-27 registry export and were not in the published catalogue before. */
  added?: string;
  reveals: string;
  field: string;
  status: 'defined' | 'new';
  access: string;
  source: string;
  /** Ids in the code that build this hexagon when they differ from `id` (the CK-8502 X hexagons). */
  code_ids?: string[];
  note?: string;
  /** MPC-8689 owner decisions batch 1 (2026-10-29): 'not_planned' or 'later', with the decision number and reason. Absent = still open (or an earlier drop or hold recorded in hexagons-366.json). */
  plan?: 'not_planned' | 'later';
  plan_decision?: number;
  plan_reason?: string;
}
export const CATALOGUE_CHANNELS: CatalogueChannel[];
export const CATALOGUE_VERSION: string;
export const HEXAGON_CATALOGUE: CatalogueHexagon[];
