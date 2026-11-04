// MPC-8689 pilot: helpers shared by the extra-hexagon endpoints (SMS, Viber, LINE; Discord has its own). Extras are checked but outside every score and count,
// off by default, allow-listed test accounts only, nothing stored, nothing logged from a payload. "returned" = the payload carried the field; "not_returned" =
// it did not (never "protected"); "not_checked" = the check could not run.
import type { ObservationState } from "../../../shared/hexagon-registry/channels.js";

export interface ExtraDef { id: string; label: string; arrival: "A" | "B" | "C" | "D"; source: string }
export interface ExtraState { id: string; arrival: ExtraDef["arrival"]; state: ObservationState }
export type Obj = Record<string, unknown>;

export const obj = (v: unknown): Obj | null => (v && typeof v === "object" && !Array.isArray(v) ? (v as Obj) : null);
export const filled = (v: unknown): boolean => v !== undefined && v !== null && v !== "" && !(Array.isArray(v) && v.length === 0);

/** Our own test accounts, comma separated. An empty or unset list means nobody (fails closed). */
export const allowedId = (list: string | undefined, id: unknown): boolean => typeof id === "string" && id !== "" && (list ?? "").split(",").map((x) => x.trim()).filter(Boolean).includes(id);

export function toStates(defs: readonly ExtraDef[], returned: Record<string, boolean>, notChecked: readonly string[] = []): ExtraState[] {
  return defs.map((d) => ({ id: d.id, arrival: d.arrival, state: notChecked.includes(d.id) || !(d.id in returned) ? "not_checked" : returned[d.id] ? "returned" : "not_returned" }));
}

/** The private reply. Lists only what was seen as seen. */
export function extrasReply(channel: string, defs: readonly ExtraDef[], states: ExtraState[]): string {
  const label = (id: string) => defs.find((d) => d.id === id)?.label ?? id;
  const seen = states.filter((s) => s.state === "returned").map((s) => label(s.id));
  const not = states.filter((s) => s.state === "not_returned").map((s) => label(s.id));
  const skipped = states.filter((s) => s.state === "not_checked").map((s) => label(s.id));
  return [
    `What ${channel} sent us with this message (${seen.length} of ${states.length - skipped.length} checked):`,
    `Seen: ${seen.join(", ") || "none"}`,
    ...(not.length ? [`Not in this message: ${not.join(", ")}`] : []),
    ...(skipped.length ? [`Not checked: ${skipped.join(", ")}`] : []),
    "These are extra checks and are not part of any score. Nothing was stored.",
  ].join("\n");
}

const enc = new TextEncoder();
export const b64 = (bytes: Uint8Array): string => btoa(String.fromCharCode(...bytes));
export async function hmac(algo: "SHA-1" | "SHA-256", secret: string, data: string): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: algo }, false, ["sign"]);
  return new Uint8Array(await crypto.subtle.sign("HMAC", key, enc.encode(data)));
}
