export type ChannelCode = string;
export type ArrivalId = 'A' | 'B' | 'C' | 'D';
export type ObservationState = 'returned' | 'not_returned' | 'not_checked' | 'check_failed' | 'user_provided';

export const CHANNELS: Record<string, { code: ChannelCode; label: string }>;
export const ARRIVAL: Record<ArrivalId, { id: ArrivalId; label: string; colour: string; ring: 'solid-thick' | 'solid' | 'dashed' | 'dotted'; note: string }>;
export const OBSERVATION_STATES: ObservationState[];

export interface ChannelHexagon {
  id: string;
  channel: ChannelCode;
  label: string;
  arrival: ArrivalId;
  source: string;
  observation: 'direct' | 'inferred';
  enabled: boolean;
  disabledReason?: string;
  note?: string;
}

export const TELEGRAM_HEXAGONS: ChannelHexagon[];
/** MPC-8689 pilot: built and checked, but outside the 30, the risk number and every score. */
export const TELEGRAM_EXTRA_HEXAGONS: ChannelHexagon[];
export const TELEGRAM_EXTRA_IDS: string[];
export const EMAIL_EXTRA_IDS: string[];
export const WEB_EXTRA_IDS: string[];
export const DISCORD_EXTRA_IDS: string[];
export const RECORDS_EXTRA_IDS: string[];
export const EXTRA_HEXAGON_IDS: string[];
export const X_HEXAGONS: ChannelHexagon[];
export const X_HEXAGON_COUNT: number;
export const CHANNEL_HEXAGONS: Record<string, ChannelHexagon[]>;
export const TELEGRAM_HEXAGON_COUNT: number;
export function getChannelHexagon(id: string): ChannelHexagon | null;
export function channelOfHexagon(id: string): ChannelCode | null;
