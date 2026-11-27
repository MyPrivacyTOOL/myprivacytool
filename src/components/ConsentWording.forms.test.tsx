// MPC-11120 item 4: every consent box that used the shared default ("Email me my results and occasional privacy tips") now says what its own
// form sends, is unsubscribe-only (MPC-10831) and offers no marketing opt-in. These fail on the old wording.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderPage, jsonResponse } from "@/test/render";
import Start from "@/pages/Start";
import Business from "@/pages/Business";
import Enterprise from "@/pages/Enterprise";
import AIAccessCheck from "@/pages/AIAccessCheck";
import Pricing from "@/pages/Pricing";
import AliceHDModal from "@/components/AliceHDModal";
import {
  START_CONSENT_LABEL, BUSINESS_CONSENT_LABEL, ENTERPRISE_CONSENT_LABEL, AI_CHECK_CONSENT_LABEL, WAITLIST_CONSENT_LABEL, ALICE_CONSENT_LABEL,
} from "@/lib/consentWording";

beforeEach(() => {
  window.scrollTo = vi.fn() as unknown as typeof window.scrollTo;
  vi.stubGlobal("fetch", vi.fn(async () => jsonResponse({})));
});
afterEach(() => vi.unstubAllGlobals());

const labelText = () => screen.getByRole("checkbox").closest("label")!.textContent ?? "";

function expectHonest(text: string, expected: string, lead: RegExp) {
  expect(text).toBe(expected);
  expect(text).toMatch(lead);
  expect(text).toMatch(/I can unsubscribe at any time/);
  expect(text).toMatch(/no separate marketing opt-in/);
  expect(text).not.toMatch(/privacy tips|newsletter|my results/i);
}

describe("consent box wording (MPC-11120 item 4)", () => {
  it("/start", async () => {
    renderPage(<Start />);
    await userEvent.setup().click(screen.getByRole("button", { name: /join the list/i }));
    expectHonest(labelText(), START_CONSENT_LABEL, /^Email me a confirmation and updates about my sign-up\./);
  });
  it("/business", () => {
    renderPage(<Business />);
    expectHonest(labelText(), BUSINESS_CONSENT_LABEL, /^Email me my company audit and follow-up about it\./);
  });
  it("/enterprise", () => {
    renderPage(<Enterprise />);
    expectHonest(labelText(), ENTERPRISE_CONSENT_LABEL, /^Email me to arrange the demo\./);
  });
  it("/ai-access-check", () => {
    renderPage(<AIAccessCheck />);
    expectHonest(labelText(), AI_CHECK_CONSENT_LABEL, /^Email me about the AI Access report\./);
  });
  it("/pricing waitlist", () => {
    renderPage(<Pricing />);
    fireEvent.click(screen.getAllByRole("button", { name: "Choose plan" })[1]);
    expectHonest(labelText(), WAITLIST_CONSENT_LABEL, /^Email me when this plan is available\./);
  });
  it("Alice HD waitlist", () => {
    render(<AliceHDModal isOpen onClose={() => {}} />);
    expectHonest(labelText(), ALICE_CONSENT_LABEL, /^Email me when Alice HD is available\./);
  });
});
