export type ChannelCode = 'TG' | 'WA' | 'X';
export type ArrivalId = 'A' | 'B' | 'C' | 'D';
export type ObservationState = 'returned' | 'not_returned' | 'not_checked' | 'check_failed' | 'user_provided';

export const CHANNELS: Record<'telegram' | 'whatsapp' | 'x', { code: ChannelCode; label: string }>;
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
export const X_HEXAGONS: ChannelHexagon[];
export const X_HEXAGON_COUNT: number;
export const CHANNEL_HEXAGONS: Record<string, ChannelHexagon[]>;
export const TELEGRAM_HEXAGON_COUNT: number;
export function getChannelHexagon(id: string): ChannelHexagon | null;
export function channelOfHexagon(id: string): ChannelCode | null;
