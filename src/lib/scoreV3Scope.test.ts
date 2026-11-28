// MPC-11569: exposure-v3's "Your settings" vs "Always sent" split for the web scan is the approved fix model (MPC-8733): a hexagon is changeable exactly when it has a typed fix block.
// scripts/build-scope-v3.mjs pins the list (a node script cannot import this TypeScript); this keeps the two equal.
import { describe, expect, it } from "vitest";
import { FIX_BLOCK_IDS, NO_ACTION_IDS } from "@/lib/hexagonFix";
import { CHANGEABLE_WEB } from "../../scripts/build-scope-v3.mjs";
import { scopeFor } from "../../shared/hexagon-registry/scoreV3.js";
import { NOT_OBSERVABLE_WEB } from "../../shared/hexagon-registry/scopeV3.js";

describe("exposure-v3 web scope matches the approved fix model", () => {
  it("changeable web data points are exactly the hexagons with a typed fix block", () => {
    const changeable = scopeFor("web").filter((r) => r.changeable).map((r) => r.id).sort();
    expect(changeable).toEqual([...FIX_BLOCK_IDS].sort());
    expect([...CHANGEABLE_WEB].sort()).toEqual([...FIX_BLOCK_IDS].sort());
  });

  it("every always-sent web data point has a no-action reason, and the seven the site cannot observe are no-action too", () => {
    for (const r of scopeFor("web").filter((x) => !x.changeable)) expect(NO_ACTION_IDS).toContain(r.id);
    for (const id of NOT_OBSERVABLE_WEB) expect(NO_ACTION_IDS).toContain(id);
  });
});
