// MPC-11569 / MPC-11622: the web channel's "Your settings" vs "Always sent" split on the shared exposure core is the approved fix model (MPC-8733): a web hexagon is
// changeable exactly when it has a typed fix block. scripts/build-exposure-scope.mjs pins the list (a node script cannot import this TypeScript); this keeps the two equal.
import { describe, expect, it } from "vitest";
import { FIX_BLOCK_IDS, NO_ACTION_IDS } from "@/lib/hexagonFix";
import { CHANGEABLE_WEB } from "../../scripts/build-exposure-scope.mjs";
import { WEB_EXPOSURE } from "../../shared/exposure/channels/web.js";
import { NOT_OBSERVABLE_WEB } from "../../shared/exposure/channels/scope.generated.js";

describe("exposure web scope matches the approved fix model", () => {
  it("settings fields are exactly the hexagons with a typed fix block", () => {
    const settings = WEB_EXPOSURE.fields.filter((f) => f.group === "settings").map((f) => f.id).sort();
    expect(settings).toEqual([...FIX_BLOCK_IDS].sort());
    expect([...CHANGEABLE_WEB].sort()).toEqual([...FIX_BLOCK_IDS].sort());
  });

  it("every always-sent web field has a no-action reason, and the seven the site cannot observe are no-action too", () => {
    for (const f of WEB_EXPOSURE.fields.filter((x) => x.group === "base")) expect(NO_ACTION_IDS).toContain(f.id);
    for (const id of NOT_OBSERVABLE_WEB) expect(NO_ACTION_IDS).toContain(id);
  });
});
