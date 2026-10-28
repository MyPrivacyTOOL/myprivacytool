export interface CatalogueChannel { key: string; code: string; label: string; group: 'Core' | 'Global social' | 'Asian' | 'Offline' }
export interface CatalogueHexagon {
  id: string;
  slug: string;
  channel: string;
  group: 'Core' | 'Global social' | 'Asian' | 'Offline';
  arrival: 'A' | 'B' | 'C' | 'D';
  risk: 'high' | 'medium' | 'low';
  label: string;
  reveals: string;
  field: string;
  status: 'defined' | 'new';
  access: string;
  source: string;
  /** Ids in the code that build this hexagon when they differ from `id` (the CK-8502 X hexagons). */
  code_ids?: string[];
  note?: string;
}
export const CATALOGUE_CHANNELS: CatalogueChannel[];
export const CATALOGUE_VERSION: string;
export const HEXAGON_CATALOGUE: CatalogueHexagon[];
