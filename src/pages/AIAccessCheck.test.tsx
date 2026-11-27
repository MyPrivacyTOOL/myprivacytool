// MPC-9814 (F1, C42): the broker section of /ai-access-check is true of the code. Synthetic, no network.
import { describe, expect, it } from "vitest";
import { screen } from "@testing-library/react";
import { renderPage } from "@/test/render";
import AIAccessCheck from "./AIAccessCheck";
import Start from "./Start";
import { FEATURE_STATUS } from "@/config/featureStatus";
import { BROKER_SITES } from "../../workers/scan-report/lib/brokers.js";

describe("/ai-access-check broker section", () => {
  it("says what runs today, marks paid coverage Planned, and links the nine guides in registry order", () => {
    renderPage(<AIAccessCheck />);
    const sec = screen.getByTestId("ai-check-brokers");
    expect(sec.textContent).toMatch(/We do not search any broker site for you/);
    expect(sec.textContent).toMatch(/checks pages you show us/i);
    expect(sec.textContent).toMatch(/Paid coverage will look for you .* not live yet/);
    expect(sec.querySelector('[data-feature-status="planned"]')?.textContent).toBe("Planned");
    const links = [...screen.getByTestId("ai-check-broker-guides").querySelectorAll("a")].map((a) => a.getAttribute("href"));
    expect(links).toEqual(BROKER_SITES.map((b: { guide: string }) => `/opt-out-guides/${b.guide}`)); // same nine, same order, as the report's registry
    expect(sec.textContent).toMatch(/Hong Kong and Singapore/);
  });
  it("no sentence on the page implies broker search exists", () => {
    renderPage(<AIAccessCheck />);
    const page = document.body.textContent ?? "";
    expect(page).not.toMatch(/we (search|scan|check) (the )?(data )?brokers? (sites? )?for you/i);
    expect(page).toMatch(/does not search broker sites for you/);
  });
  it("F1 marker follows the feature status: shown while in build, gone once live", () => {
    renderPage(<AIAccessCheck />);
    const todayMarker = screen.getByTestId("ai-check-brokers").querySelector('[data-feature="F1"][data-feature-status]');
    if (FEATURE_STATUS.F1 === "live") expect(screen.getByTestId("ai-check-brokers").querySelectorAll('[data-feature-status="in_build"]')).toHaveLength(0);
    else expect(todayMarker).not.toBeNull();
  });
});

describe("/start honest sentence", () => {
  it("states that no broker search is included and that a pasted page is verified", () => {
    renderPage(<Start />);
    expect(document.body.textContent).toMatch(/We don't search broker sites for you yet — paste any page that lists you and we'll verify it\. Paid plans will add coverage\./);
    expect(document.body.textContent).not.toMatch(/No data broker search is included yet/);
  });
});
