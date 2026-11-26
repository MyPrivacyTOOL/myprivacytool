// MPC-11111: the magic guess on /scan. Off by default; when on, a sealed token in the bridge link's fragment is opened by the Worker and the address
// the person published in their own bio is offered back. Saying yes only fills the box. Nothing is sent or scanned by tapping it.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderPage, jsonResponse } from "@/test/render";
import Scan from "./Scan";
import { setChoice } from "@/lib/cookieConsent";
import { resetGuessTokenForTests } from "@/lib/emailGuess";
import recipientsData from "../../shared/recipients/recipients.data.js";
import { parseRegistry } from "../../shared/recipients/registry";
import { setBundledRegistryForTests } from "../../shared/recipients/outbound";

// The call happens before the visitor's scan consent click, so it goes through its own pre_click registry entry, which ships DISABLED. Happy-path tests switch it on.
const registryWithEntry = (enabled: boolean) => {
  const reg = parseRegistry(JSON.parse(JSON.stringify(recipientsData)));
  reg.recipients.find((r) => r.key === "email-guess-service")!.enabled = enabled;
  return reg;
};

const TOKEN = "v1.AAAAAAAAAAAAAAAA.BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB";
const ADDRESS = "zelda.quillfeather@example.test";
const found = { guess: { email: ADDRESS, channel: "x", confidence: 0.9, basis: "bio_email" } };

let gtag: ReturnType<typeof vi.fn>;
beforeEach(() => {
  window.scrollTo = vi.fn() as unknown as typeof window.scrollTo;
  sessionStorage.clear(); localStorage.clear();
  resetGuessTokenForTests();
  gtag = vi.fn();
  (window as unknown as { gtag: unknown }).gtag = gtag;
  window.history.replaceState(null, "", "/scan");
});
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); delete (window as unknown as { gtag?: unknown }).gtag; });

const worker = (answer: () => Response | Promise<Response>) => {
  const f = vi.fn(async (url: unknown) => (String(url).endsWith("/api/scan/guess") ? answer() : jsonResponse({ inlineMessage: "ok" })));
  vi.stubGlobal("fetch", f);
  return f;
};
const guessCalls = (f: ReturnType<typeof worker>) => (f.mock.calls as unknown[][]).filter((c) => String(c[0]).endsWith("/api/scan/guess"));
const events = () => gtag.mock.calls.filter((c) => c[0] === "event").map((c) => ({ name: c[1] as string, params: c[2] as Record<string, unknown> }));
const box = () => screen.getAllByLabelText("Email address")[0] as HTMLInputElement;

describe("Scan page: the magic guess (MPC-11111)", () => {
  it("is off by default: a token in the address is ignored, nothing is asked and no card shows", async () => {
    const f = worker(() => jsonResponse(found));
    window.history.replaceState(null, "", `/scan#g=${TOKEN}`);
    renderPage(<Scan />);
    await new Promise((r) => setTimeout(r, 20));
    expect(guessCalls(f)).toHaveLength(0);
    expect(screen.queryByTestId("email-guess-card")).toBeNull();
    expect(box().value).toBe("");
  });

  it("shipped state: site flag on but the registry entry still disabled: nothing is asked and no card shows", async () => {
    vi.stubEnv("VITE_EMAIL_GUESS_ENABLED", "true");
    setChoice(true);
    const f = worker(() => jsonResponse(found));
    window.history.replaceState(null, "", `/scan#g=${TOKEN}`);
    renderPage(<Scan />);
    await new Promise((r) => setTimeout(r, 30));
    expect(guessCalls(f)).toHaveLength(0);
    expect(screen.queryByTestId("email-guess-card")).toBeNull();
  });

  describe("when switched on (flag on and the registry entry enabled)", () => {
    let restore: (() => void) | null = null;
    beforeEach(() => { vi.stubEnv("VITE_EMAIL_GUESS_ENABLED", "true"); setChoice(true); restore = setBundledRegistryForTests(registryWithEntry(true)); });
    afterEach(() => { restore?.(); restore = null; });

    it("opens the token, shows the address, brings the card into view, and removes the token from the address bar", async () => {
      const scrollIntoView = vi.fn();
      Element.prototype.scrollIntoView = scrollIntoView as unknown as typeof Element.prototype.scrollIntoView;
      const f = worker(() => jsonResponse(found));
      window.history.replaceState(null, "", `/scan?utm_source=x&utm_medium=channel_osint#g=${TOKEN}`);
      renderPage(<Scan />);
      expect(await screen.findByTestId("email-guess-card")).toHaveTextContent(ADDRESS);
      expect(scrollIntoView).toHaveBeenCalledTimes(1);
      expect(guessCalls(f)).toHaveLength(1);
      expect(JSON.parse(String((guessCalls(f)[0][1] as RequestInit).body))).toEqual({ token: TOKEN });
      expect(window.location.hash).toBe("");
      expect(window.location.search).toBe("?utm_source=x&utm_medium=channel_osint");   // the tags stay
      expect(events().map((e) => e.name)).toContain("email_guess_shown");
    });

    it("yes fills the box and nothing more: no report request, card gone, answer tracked without the address", async () => {
      const f = worker(() => jsonResponse(found));
      window.history.replaceState(null, "", `/scan#g=${TOKEN}`);
      const user = userEvent.setup();
      renderPage(<Scan />);
      await user.click(await screen.findByRole("button", { name: /yes, use this one/i }));
      expect(box().value).toBe(ADDRESS);
      expect(screen.queryByTestId("email-guess-card")).toBeNull();
      expect(f.mock.calls.some((c) => String(c[0]).endsWith("/api/scan"))).toBe(false);   // nothing sent, nothing scanned
      const answered = events().find((e) => e.name === "magic_guess_submitted");
      expect(answered?.params).toMatchObject({ answer: "yes", basis: "bio_email", source: "scan_page" });
      expect(JSON.stringify(gtag.mock.calls)).not.toContain(ADDRESS);
    });

    it("no leaves the box empty, removes the card and tracks the answer", async () => {
      worker(() => jsonResponse(found));
      window.history.replaceState(null, "", `/scan#g=${TOKEN}`);
      const user = userEvent.setup();
      renderPage(<Scan />);
      await user.click(await screen.findByRole("button", { name: /no, i will type another/i }));
      expect(box().value).toBe("");
      expect(screen.queryByTestId("email-guess-card")).toBeNull();
      expect(events().find((e) => e.name === "magic_guess_submitted")?.params).toMatchObject({ answer: "no" });
    });

    it("sends no analytics events for a visitor who has not accepted analytics", async () => {
      localStorage.clear(); sessionStorage.clear();
      worker(() => jsonResponse(found));
      window.history.replaceState(null, "", `/scan#g=${TOKEN}`);
      const user = userEvent.setup();
      renderPage(<Scan />);
      await user.click(await screen.findByRole("button", { name: /yes, use this one/i }));
      expect(events().filter((e) => /guess/.test(e.name))).toEqual([]);
    });

    it("shows nothing when the Worker has no guess (expired, forged, off), fails, or is unreachable; the form still works", async () => {
      for (const answer of [() => jsonResponse({ guess: null }), () => jsonResponse({ error: "x" }, 404), () => { throw new Error("offline"); }, () => jsonResponse({ guess: { email: "not-an-email", channel: "x", confidence: 0.9, basis: "bio_email" } }), () => jsonResponse({ guess: { ...found.guess, confidence: 0.5 } })]) {
        resetGuessTokenForTests();
        const f = worker(answer);
        window.history.replaceState(null, "", `/scan#g=${TOKEN}`);
        const { unmount } = renderPage(<Scan />);
        await waitFor(() => expect(guessCalls(f)).toHaveLength(1));
        await new Promise((r) => setTimeout(r, 20));
        expect(screen.queryByTestId("email-guess-card")).toBeNull();
        expect(box().value).toBe("");
        unmount();
      }
    });

    it("ignores a fragment that is not shaped like a token, removes it, and asks nothing", async () => {
      const f = worker(() => jsonResponse(found));
      window.history.replaceState(null, "", "/scan#g=junk");
      renderPage(<Scan />);
      await new Promise((r) => setTimeout(r, 20));
      expect(guessCalls(f)).toHaveLength(0);
      expect(window.location.hash).toBe("");
      expect(screen.queryByTestId("email-guess-card")).toBeNull();
    });

    it("keeps other fragment parts and asks nothing when there is no token", async () => {
      const f = worker(() => jsonResponse(found));
      window.history.replaceState(null, "", "/scan#top");
      renderPage(<Scan />);
      await new Promise((r) => setTimeout(r, 20));
      expect(guessCalls(f)).toHaveLength(0);
      expect(window.location.hash).toBe("#top");
    });
  });
});
