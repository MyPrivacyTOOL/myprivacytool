// MPC-11569: the "we now check more, you did not become more exposed" notice shows for exposure-v2 and for nothing else.
import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import ScoreVersionNotice, { SCORE_V2_HEADLINE, SCORE_V2_DETAIL } from "@/components/ScoreVersionNotice";
import { SCORE_VERSION } from "../../shared/hexagon-registry/score.js";
import { SCORE_VERSION_V2 } from "../../shared/hexagon-registry/scoreV2.js";

afterEach(cleanup);

describe("ScoreVersionNotice", () => {
  it("says we now check more and the person did not become more exposed, for exposure-v2", () => {
    render(<ScoreVersionNotice scoreVersion={SCORE_VERSION_V2} />);
    expect(screen.getByTestId("score-version-notice")).toHaveTextContent("We now check more. You did not become more exposed.");
    expect(SCORE_V2_HEADLINE).toBe("We now check more. You did not become more exposed.");
  });

  it("renders nothing for exposure-v1, legacy, or no version: today's score is unchanged and needs no explanation", () => {
    for (const v of [SCORE_VERSION, "legacy", undefined, null, ""]) {
      const { container, unmount } = render(<ScoreVersionNotice scoreVersion={v as string | undefined} />);
      expect(container).toBeEmptyDOMElement();
      unmount();
    }
  });

  it("states no count (totals live on the Master Index only) and makes no claim of better or worse privacy", () => {
    const text = `${SCORE_V2_HEADLINE} ${SCORE_V2_DETAIL}`;
    expect(text).not.toMatch(/\d/);
    expect(text).not.toMatch(/safer|more private|improv|worse privacy/i);
  });
});
