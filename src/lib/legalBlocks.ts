import legalData from "@/data/legalBlocks.generated.json";
import type { LegalBlocks } from "../../shared/recipients/legal-blocks";
import type { Locale } from "../../shared/recipients/disclosure";

// MPC-9894: the legal-page blocks, as generated from shared/recipients/recipients.json by scripts/render-privacy-from-registry.mjs.
const BLOCKS = (legalData as unknown as { blocks: Record<Locale, LegalBlocks> }).blocks;
export const legalBlocks = (locale: Locale = "en"): LegalBlocks => BLOCKS[locale] ?? BLOCKS.en;
