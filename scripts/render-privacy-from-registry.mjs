// MPC-9894: renders the legal-page blocks (Privacy "who receives your data", Cookies recipient list, DPA sub-processors, the visit-log sentence) from
// shared/recipients/recipients.json through renderDisclosure and writes src/data/legalBlocks.generated.json. Run by `prebuild`.
//   node scripts/render-privacy-from-registry.mjs          write the file
//   node scripts/render-privacy-from-registry.mjs --check  exit 1 if the committed file differs from what the registry produces
//   node scripts/render-privacy-from-registry.mjs --print  print the Privacy recipient section as plain text (for review)
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { buildAllLegalBlocks } from "../shared/recipients/legal-blocks.ts";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = join(ROOT, "src", "data", "legalBlocks.generated.json");
const registry = JSON.parse(readFileSync(join(ROOT, "shared", "recipients", "recipients.json"), "utf8")).recipients;
const text = JSON.stringify({ _generated: "scripts/render-privacy-from-registry.mjs from shared/recipients/recipients.json (MPC-9894). Do not edit.", blocks: buildAllLegalBlocks(registry) }, null, 2) + "\n";

if (process.argv.includes("--print")) {
  const en = JSON.parse(text).blocks.en;
  for (const g of en.privacy.groups) { console.log(`\n## ${g.title}`); for (const i of g.items) console.log(`- ${i.text}`); }
  console.log("\n" + en.privacy.visit_log_sentence);
} else if (process.argv.includes("--check")) {
  let current = "";
  try { current = readFileSync(OUT, "utf8"); } catch { /* missing */ }
  if (current !== text) { console.error("[legal-blocks] src/data/legalBlocks.generated.json is out of date: run node scripts/render-privacy-from-registry.mjs"); process.exit(1); }
  console.log("[legal-blocks] up to date");
} else {
  writeFileSync(OUT, text);
  console.log(`[legal-blocks] wrote ${OUT.replace(ROOT + "/", "")}`);
}
