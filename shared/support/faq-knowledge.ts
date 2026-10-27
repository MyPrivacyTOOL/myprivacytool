import type { KnowledgeEntry, KnowledgeSource } from "./types";

/** Approval record for a body of FAQ text. It comes from configuration, never from this file: the FAQ owners (MPC-7560/7561) decide. */
export interface FaqApproval { version: string; approvedBy: string }

const STOP = new Set(["the", "and", "for", "you", "your", "can", "how", "what", "does", "this", "that", "with", "have", "are", "not", "but", "why", "from", "was", "has", "had", "its"]);
const words = (s: string): string[] => (s.toLowerCase().match(/[a-z0-9]{3,}/g) ?? []).filter((w) => !STOP.has(w));
const h = (s: string): string => { let x = 5381; for (let i = 0; i < s.length; i++) x = ((x << 5) + x + s.charCodeAt(i)) | 0; return (x >>> 0).toString(36); };

/**
 * Keyword retrieval over the published FAQ. Without an approval record every entry is a DRAFT, and `retrieve()` drops drafts, so
 * the service answers nothing from the FAQ until an owner supplies a version and approver. Nothing here marks content approved.
 */
export class FaqKnowledgeSource implements KnowledgeSource {
  constructor(private faqs: { q: string; a: string }[], private approval?: FaqApproval) {}
  async search(query: string): Promise<KnowledgeEntry[]> {
    const qw = new Set(words(query));
    if (!qw.size) return [];
    return this.faqs
      .map((f) => ({ f, score: words(f.q).filter((w) => qw.has(w)).length * 2 + words(f.a).filter((w) => qw.has(w)).length }))
      .filter((x) => x.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, 5)
      .map(({ f }) => ({
        id: `faq-${h(f.q)}`, version: this.approval?.version ?? "unversioned", status: this.approval ? "approved" as const : "draft" as const,
        approvedBy: this.approval?.approvedBy, title: f.q, body: f.a, scope: ["faq"],
      }));
  }
}
