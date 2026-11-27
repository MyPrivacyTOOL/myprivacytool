// CK-8502: also the shared allow-list for Telegram values (telegram-capture.ts). Turns the data an X event carries into hexagon values (shared/hexagon-registry/channels.js, X_HEXAGONS). Pure: no network, no lookups.
// Only fields X sent in THIS event are used (nothing is fetched, nothing is scraped, nothing is matched to another account). Values are bounded.
import { TELEGRAM_HEXAGONS, X_HEXAGONS } from "../../../shared/hexagon-registry/channels.js";
import { pick } from "./shared";

const ENABLED = new Set([...X_HEXAGONS, ...TELEGRAM_HEXAGONS].filter((h) => h.enabled).map((h) => h.id));
const MAX_STRING = 1000;
const MAX_KEYS = 40;

export type HexagonData = Record<string, string | number | boolean>;

/** Keeps only registered, enabled hexagon ids and plain bounded values. */
export function cleanData(raw: Record<string, unknown>): HexagonData | undefined {
  const out: HexagonData = {};
  for (const [id, v] of Object.entries(raw)) {
    if (!ENABLED.has(id) || Object.keys(out).length >= MAX_KEYS) continue;
    if (typeof v === "string" && v.length > 0) out[id] = v.slice(0, MAX_STRING);
    else if (typeof v === "number" && Number.isFinite(v)) out[id] = v;
    else if (typeof v === "boolean") out[id] = v;
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

/** The user-object fields X sends (names as in the docs example). */
export function userFields(u: unknown): Record<string, unknown> {
  return {
    "x.name": pick(u, "name"), "x.screen_name": pick(u, "screen_name"), "x.location": pick(u, "location"), "x.description": pick(u, "description"),
    "x.url": pick(u, "url"), "x.protected": pick(u, "protected"), "x.verified": pick(u, "verified"), "x.followers_count": pick(u, "followers_count"),
    "x.friends_count": pick(u, "friends_count"), "x.statuses_count": pick(u, "statuses_count"), "x.profile_image": pick(u, "profile_image_url_https"),
  };
}

export const eventTime = (ms: number | undefined): Record<string, unknown> => ({ "x.event_time": ms ? new Date(ms).toISOString() : undefined });
