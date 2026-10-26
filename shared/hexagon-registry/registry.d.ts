export type HexagonStatus = 'FOUND' | 'CHECKED_AND_CLEAR' | 'NOT_CHECKED';
export type TruthLevel = 'measured' | 'estimated' | 'cannot_be_checked';

export interface HexagonRegistryEntry {
  id: string;
  label: string;
  group: string;
  category: string;
  order: number;
  artwork: { file: string | null; emoji: string; note: string };
  captures: string;
  value_to_user: string;
  value_type: string;
  presence: 'always' | 'conditional';
  /** MPC-7471-F2: optional. Names a device capability; the entry is left out of the scan total only when the device is known not to have it. */
  applies_when?: { capability: string };
  user_can_check: 'yes' | 'partly' | 'no';
  example_value: string;
  truth: {
    confidence: { number: number | null; how: 'fixed' | 'calculated' | 'none'; note: string | null };
    risk: { how: string; text: string };
    sensitivity: 'low' | 'medium' | 'high';
    level: TruthLevel;
    note: string;
  };
  status: {
    kind: string;
    allowed: HexagonStatus[];
    default: HexagonStatus | null;
    code_cannot_tell_clear_from_not_checked: boolean;
    found: string;
    clear: string;
    not_checked: string;
    detection_change_to_make_checkable: string | null;
  };
  trust_score: null;
  source: string;
}

export interface EmailHexagonEntry {
  id: string;
  label: string;
  group: string;
  category: string;
  order: number;
  artwork: { file: string | null; emoji: string; note: string };
  captures: string;
  value_type: string;
  presence: 'always' | 'conditional';
  example_value: string;
  truth: { level: TruthLevel; sensitivity: string; note: string };
  status: { kind: string; allowed: HexagonStatus[]; found: string; clear: string; not_checked: string };
  trust_score: null;
  source: string;
  build_status: string;
}

export const HEXAGONS: HexagonRegistryEntry[];
export const EMAIL_HEXAGONS: EmailHexagonEntry[];
export const STATUSES: HexagonStatus[];
export const TRUTH_LEVELS: TruthLevel[];
export const HEXAGON_COUNT: number;
export const HEXAGON_ALWAYS_COUNT: number;
export const HEXAGON_CONDITIONAL_COUNT: number;
export const HEXAGON_GROUPS: string[];
export const HEXAGON_GROUP_COUNT: number;
export function getHexagon(id: string): HexagonRegistryEntry | undefined;
export function isKnownHexagonId(id: string): boolean;
export function hexagonLabel(id: string, fallback?: string): string;
