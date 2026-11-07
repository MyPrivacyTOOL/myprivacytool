// MPC-9832: "46" was a hard-coded display number, never a count of the list (54 run in the scan, 368 are in the catalogue).
// This fails if a 46-hexagon claim comes back anywhere in the shipped code or content. Changelogs and historical notes
// under docs/ are exempt; so are the two tests that quote the old phrase on purpose.
import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const ROOT = join(__dirname, "..", "..");
const SCAN = ["src", "shared", "scripts", "workers", "locales", "public", "e2e", "index.html"];
const SKIP_DIR = new Set(["node_modules", "dist", ".git"]);
const TEXT = /\.(tsx?|jsx?|mjs|cjs|json|html|md|txt|css|sql)$/;
const EXEMPT = [/changelog/i, /^src\/lib\/noStale46\.test\.ts$/, /^src\/lib\/scanCountsCopy\.test\.ts$/];
export const STALE_46 = /\b46[\s-]+(hexagons?|things|data[\s-]?points|vectors|privacy vectors)\b/i;

const walk = (p: string, out: string[] = []): string[] => {
  const st = statSync(p);
  if (st.isDirectory()) {
    for (const f of readdirSync(p)) if (!SKIP_DIR.has(f)) walk(join(p, f), out);
  } else if (TEXT.test(p)) out.push(p);
  return out;
};

describe("no 46-hexagon claim (MPC-9832)", () => {
  it("pattern catches the old phrasings", () => {
    for (const bad of ["46 hexagons", "all 46 hexagon", "The 46 Things Tracking", "46 data points", "46-hexagon model"]) {
      expect(STALE_46.test(bad)).toBe(true);
    }
    expect(STALE_46.test("54 run in the scan, 368 in the catalogue")).toBe(false);
  });

  it("appears nowhere in shipped code or content", () => {
    const hits: string[] = [];
    for (const target of SCAN) {
      let files: string[] = [];
      try { files = walk(join(ROOT, target)); } catch { continue; }
      for (const f of files) {
        const rel = relative(ROOT, f).replace(/\\/g, "/");
        if (EXEMPT.some((r) => r.test(rel))) continue;
        readFileSync(f, "utf8").split("\n").forEach((line, i) => {
          if (STALE_46.test(line)) hits.push(`${rel}:${i + 1}: ${line.trim().slice(0, 100)}`);
        });
      }
    }
    expect(hits).toEqual([]);
  });
});
