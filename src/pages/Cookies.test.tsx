// MPC-9801: the Cookie Policy must name the cookies the code really sets, and must not name ones that do not exist.
// The names are read from the Workers that set them, so adding a cookie there without listing it here fails this test.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { screen } from "@testing-library/react";
import { renderPage } from "@/test/render";
import Cookies from "./Cookies";

const flat = (s: string) => s.replace(/\s+/g, " ").trim();

// Every cookie our Workers set (Set-Cookie): file -> the constants that hold the cookie name.
const COOKIE_SOURCES: Record<string, RegExp> = {
  "workers/github-channel/index.js": /const (?:STATE|SESSION)_COOKIE = '([a-z_]+)'/g,
  "workers/github-channel/lib/reddit-routes.js": /const (?:STATE|SESSION)_COOKIE = '([a-z_]+)'/g,
  "workers/oauth-poc/index.js": /const COOKIE = '([a-z_]+)'/g,
  "workers/oauth-poc/session.js": /export const SESSION_COOKIE = '([a-z_]+)'/g,
};

const cookieNamesInCode = (): string[] =>
  Object.entries(COOKIE_SOURCES).flatMap(([file, re]) => [...readFileSync(file, "utf8").matchAll(re)].map((m) => m[1]));

describe("Cookie Policy: essential list matches the code", () => {
  it("names every cookie a Worker sets", () => {
    const names = cookieNamesInCode();
    expect(names.length).toBeGreaterThanOrEqual(6); // gh x2, reddit x2, google x2: a smaller count means a pattern above stopped matching
    renderPage(<Cookies />);
    const text = flat(document.body.textContent ?? "");
    for (const name of names) expect(text, `Cookies page does not name the cookie ${name}`).toContain(name);
  });

  it("names the browser-storage keys it relies on", () => {
    renderPage(<Cookies />);
    const text = flat(document.body.textContent ?? "");
    for (const key of ["mpt_cookie_consent", "mpt_scan_consent", "mpt_account_session"]) expect(text).toContain(key);
  });

  it("no longer lists a Session ID cookie, a CSRF token cookie or a generic security-token cookie that nothing sets", () => {
    renderPage(<Cookies />);
    expect(screen.getByRole("heading", { name: "2.1 Essential / Functional Cookies" })).toBeInTheDocument();
    const text = flat(document.body.textContent ?? "");
    expect(text).not.toMatch(/Session ID:/);
    expect(text).not.toMatch(/CSRF Token:/);
    expect(text).not.toMatch(/Security Tokens:/);
  });

  it("keeps the no-marketing-cookies statement and the analytics-only-after-consent statement", () => {
    renderPage(<Cookies />);
    const text = flat(document.body.textContent ?? "");
    expect(text).toContain("We set no marketing or advertising cookies.");
    expect(text).toContain("only run after you allow analytics in our cookie banner");
  });
});
