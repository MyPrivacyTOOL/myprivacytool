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
}
export const CATALOGUE_CHANNELS: CatalogueChannel[];
export const CATALOGUE_VERSION: string;
export const HEXAGON_CATALOGUE: CatalogueHexagon[];
