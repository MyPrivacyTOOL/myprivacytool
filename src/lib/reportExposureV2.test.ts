// MPC-11569: the sentence in the report JSON (workers/scan-report/lib/reportHex.js) is the same text as the on-page notice (ScoreVersionNotice).
import { describe, expect, it } from "vitest";
import { SCORE_V2_EXPLANATION, webAndEmailExposure } from "../../workers/scan-report/lib/reportHex.js";
import { SCORE_V2_HEADLINE, SCORE_V2_DETAIL } from "@/components/ScoreVersionNotice";

describe("report JSON exposure_v2 explanation", () => {
  it("matches the on-page notice word for word", () => {
    expect(SCORE_V2_EXPLANATION.headline).toBe(SCORE_V2_HEADLINE);
    expect(SCORE_V2_EXPLANATION.detail).toBe(SCORE_V2_DETAIL);
  });
  it("is attached to every exposure_v2 result, scored over 60, with email-breaches not counted", () => {
    const r = webAndEmailExposure([{ id: "location", status: "found" }], [{ id: "email-name", status: "clear" }, { id: "email-breaches", status: "not_checked" }]);
    expect(r.score_version).toBe("exposure-v2");
    expect(r.coverage.total).toBe(60);
    expect(r.explanation).toEqual(SCORE_V2_EXPLANATION);
    expect(r.rejected).toEqual([{ id: "email-breaches", reason: "not_built" }]);
  });
});
