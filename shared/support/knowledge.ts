import type { KnowledgeEntry, KnowledgeSource } from "./types";

export interface Retrieval { entries: KnowledgeEntry[]; failed: boolean }

/** Only approved, versioned, attributed entries are usable. Draft/retired/unattributed entries are dropped here. */
export async function retrieve(src: KnowledgeSource | undefined, query: string, locale?: string): Promise<Retrieval> {
  if (!src) return { entries: [], failed: false };
  try {
    const all = await src.search(query, locale);
    return { entries: all.filter((e) => e.status === "approved" && !!e.version && !!e.approvedBy).slice(0, 5), failed: false };
  } catch {
    return { entries: [], failed: true };
  }
}
