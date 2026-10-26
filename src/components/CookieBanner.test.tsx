import { afterEach, describe, expect, it } from "vitest";
import { act, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderPage } from "@/test/render";
import CookieBanner from "./CookieBanner";
import { getChoice, hasConsent, openCookiePreferences, setChoice } from "@/lib/cookieConsent";

afterEach(() => { localStorage.clear(); });

describe("CookieBanner (MPC-8450)", () => {
  it("shows on a first visit with two equal buttons and a cookie policy link, and sets nothing yet", () => {
    renderPage(<CookieBanner />);
    expect(screen.getByRole("dialog")).toBeTruthy();
    expect(screen.getByText("Your privacy, your choice")).toBeTruthy();
    const accept = screen.getByRole("button", { name: "Accept analytics" });
    const essential = screen.getByRole("button", { name: "Essential only" });
    expect(accept.className).toBe(essential.className);
    expect(screen.getByRole("link", { name: "Cookie policy" }).getAttribute("href")).toBe("/cookies");
    expect(getChoice()).toBeNull();
  });

  it("Accept analytics: one click, banner closes, consent is on", async () => {
    renderPage(<CookieBanner />);
    await userEvent.click(screen.getByRole("button", { name: "Accept analytics" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(hasConsent()).toBe(true);
  });

  it("Essential only: one click, banner closes, consent stays off but a choice is recorded", async () => {
    renderPage(<CookieBanner />);
    await userEvent.click(screen.getByRole("button", { name: "Essential only" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(hasConsent()).toBe(false);
    expect(getChoice()?.analytics).toBe(false);
  });

  it("does not show again once a choice exists, and Manage cookies reopens it", () => {
    setChoice(true);
    renderPage(<CookieBanner />);
    expect(screen.queryByRole("dialog")).toBeNull();
    act(() => openCookiePreferences());
    expect(screen.getByRole("dialog")).toBeTruthy();
  });
});
