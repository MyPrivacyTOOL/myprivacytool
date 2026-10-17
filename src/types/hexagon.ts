// Human-in-the-loop identity confirmation: the status model for findings the user can confirm or dispute.
// Separate from the web-scan registry statuses (found / clear / not_checked in shared/hexagon-registry).

export type ObservationStatus =
  | 'checked'
  | 'given'
  | 'guess'
  | 'not_checked'
  | 'confirmed'
  | 'false_positive'
  | 'disputed';

export type InteractionState =
  | 'pending_confirmation'
  | 'confirmed_by_user'
  | 'rejected_by_user'
  | 'disputed_by_user';

export interface Hexagon {
  id: string;
  pillar: string;
  label: string;
  status: ObservationStatus;
  data: string | null;
  source: string | null;
  /** 0.0 to 1.0 (e.g. 0.95 high, 0.60 guess). */
  confidence_score?: number;
  remediation: string | null;
  /** True when the finding is something the user should act on (set by the OSINT orchestrator). Counts toward verified_exposure_count. */
  exposure?: boolean;
  interaction_state?: InteractionState;
}

export interface ScanResult {
  hexagons: Hexagon[];
}
