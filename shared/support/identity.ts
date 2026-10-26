import type { Channel, Identity, Verifier } from "./types";

export const ANONYMOUS: Identity = { level: "anonymous" };

/**
 * Identity for an inbound event WITHOUT a verifier proof. A platform sender id or a "yes, that is me" reply never gets
 * past `channel_asserted`, and `channel_asserted` has no tenant or subject: it cannot authorise a private action.
 */
export function assertedIdentity(senderHandle?: string): Identity {
  return senderHandle ? { level: "channel_asserted" } : ANONYMOUS;
}

/** Fail-closed wrapper: any verifier error or malformed result degrades to the asserted/anonymous identity. */
export async function resolveIdentity(v: Verifier | undefined, proof: string | undefined, channel: Channel, senderHandle?: string): Promise<Identity> {
  if (!v || !proof) return assertedIdentity(senderHandle);
  try {
    const id = await v.resolve(proof, channel, senderHandle);
    if (id.level === "verified" && (!id.subjectId || !id.tenantId)) return assertedIdentity(senderHandle);
    return id;
  } catch {
    return assertedIdentity(senderHandle);
  }
}

const RANK = { anonymous: 0, channel_asserted: 1, verified: 2 } as const;
export const meets = (have: Identity, need: Identity["level"]): boolean => RANK[have.level] >= RANK[need];
