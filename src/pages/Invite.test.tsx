// /invite (MPC-7645): the friend's landing, the private manage view, and the switch that sends everyone to /scan while the programme is off.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { jsonResponse } from "@/test/render";
import Invite from "./Invite";

const TOKEN = "b".repeat(64);
type Gtag = (kind: string, name: string, params?: Record<string, unknown>) => void;
const gtagCalls = () => ((window as unknown as { gtag: ReturnType<typeof vi.fn> }).gtag.mock.calls as unknown[][]).map((c) => [c[1], c[2]]);
const STATUS = { ok: true, share_url: "https://myprivacytool.io/invite?ref=ABCDEFGH", signed_up: 2, completed: 1, months_earned: 1, max_months: 12, invites_sent: 2, invites_left: 8 };

const renderAt = (route: string) =>
  render(
    <MemoryRouter initialEntries={[route]}>
      <Routes>
        <Route path="/invite" element={<Invite />} />
        <Route path="/scan" element={<p>scan page</p>} />
      </Routes>
    </MemoryRouter>,
  );

beforeEach(() => { sessionStorage.clear(); (window as unknown as { gtag: Gtag }).gtag = vi.fn(); });
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); delete (window as unknown as { gtag?: Gtag }).gtag; });

describe("Invite", () => {
  it("while the programme is off, everyone lands on /scan", () => {
    renderAt("/invite?ref=ABCDEFGH");
    expect(screen.getByText("scan page")).toBeInTheDocument();
  });

  describe("switched on", () => {
    beforeEach(() => vi.stubEnv("VITE_REFERRALS_ENABLED", "true"));

    it("a friend's link: plain landing that passes the code on to /scan and remembers it for this visit", () => {
      renderAt("/invite?ref=abcdefgh");
      expect(screen.getByRole("link", { name: /check my exposure/i })).toHaveAttribute("href", "/scan?ref=ABCDEFGH");
      expect(sessionStorage.getItem("mpt_referral_code")).toBe("ABCDEFGH");
      expect(screen.queryByRole("button", { name: /send invitations/i })).not.toBeInTheDocument();
    });

    it("a bad code is just the explainer, remembers nothing", () => {
      renderAt("/invite?ref=nope");
      expect(sessionStorage.getItem("mpt_referral_code")).toBeNull();
      expect(screen.getByText(/in your privacy report email/i)).toBeInTheDocument();
    });

    it("says the reward honestly: Pro is not on sale yet", () => {
      renderAt("/invite");
      expect(screen.getAllByText(/pro is not on sale yet/i).length).toBeGreaterThan(0);
    });

    it("the private link shows progress, validates addresses, then sends the invitations with the code and token", async () => {
      const f = vi.fn(async (url: string) => (String(url).endsWith("/status") ? jsonResponse(STATUS) : jsonResponse({ ok: true, sent: 2, skipped: 0 })));
      vi.stubGlobal("fetch", f);
      const user = userEvent.setup();
      renderAt(`/invite#c=ABCDEFGH&t=${TOKEN}`);

      const stats = await screen.findByLabelText("Your invitations");
      expect(within(stats).getByText("Got their report").nextSibling).toHaveTextContent("1");
      expect(screen.getByLabelText("Your invite link")).toHaveValue(STATUS.share_url);
      const statusCall = f.mock.calls[0] as unknown as [string, RequestInit];
      expect(statusCall[0]).toMatch(/\/api\/referral\/status$/);
      expect(JSON.parse(statusCall[1].body as string)).toEqual({ code: "ABCDEFGH", token: TOKEN });

      await user.click(screen.getByRole("button", { name: /send invitations/i }));
      expect(await screen.findByRole("alert")).toHaveTextContent(/at least one/i);
      await user.type(screen.getByLabelText("Friend 1 email"), "not-an-email");
      await user.click(screen.getByRole("button", { name: /send invitations/i }));
      expect(await screen.findByRole("alert")).toBeInTheDocument();
      expect(f).toHaveBeenCalledTimes(1);   // nothing sent for invalid input

      await user.clear(screen.getByLabelText("Friend 1 email"));
      await user.type(screen.getByLabelText("Friend 1 email"), "one@example.com");
      await user.type(screen.getByLabelText("Friend 2 email"), "two@example.com");
      await user.click(screen.getByRole("button", { name: /send invitations/i }));
      expect(await screen.findByText(/sent 2 invitations/i)).toBeInTheDocument();
      const invite = f.mock.calls.find((c) => String(c[0]).endsWith("/invite")) as unknown as [string, RequestInit];
      expect(JSON.parse(invite[1].body as string)).toEqual({ code: "ABCDEFGH", token: TOKEN, emails: ["one@example.com", "two@example.com"] });
    });

    it("A/B (MPC-7645): the report-email wording in the private link is counted as an exposure and tagged on the invites sent; nothing is counted without it", async () => {
      vi.stubGlobal("fetch", vi.fn(async (url: string) => (String(url).endsWith("/status") ? jsonResponse(STATUS) : jsonResponse({ ok: true, sent: 1, skipped: 0 }))));
      const user = userEvent.setup();
      renderAt(`/invite#c=ABCDEFGH&t=${TOKEN}&v=friend_first`);
      await screen.findByLabelText("Your invitations");
      expect(gtagCalls()).toContainEqual(["experiment_exposure", { experiment_id: "referral_report_block", variant_id: "friend_first" }]);
      await user.type(screen.getByLabelText("Friend 1 email"), "one@example.com");
      await user.click(screen.getByRole("button", { name: /send invitations/i }));
      await screen.findByText(/sent 1 invitation/i);
      expect(gtagCalls()).toContainEqual(["referral_invites_sent", { sent: 1, ab_referral_report_block: "friend_first" }]);
    });

    it("A/B: no experiment events when no test is running", async () => {
      vi.stubGlobal("fetch", vi.fn(async () => jsonResponse(STATUS)));
      renderAt(`/invite#c=ABCDEFGH&t=${TOKEN}`);
      await screen.findByLabelText("Your invitations");
      expect(gtagCalls().filter(([name]) => String(name).startsWith("experiment_"))).toEqual([]);
    });

    it("A/B: a friend arriving from an invitation counts the subject variant; an unknown label counts nothing", () => {
      renderAt("/invite?ref=ABCDEFGH&iv=specific_subject");
      expect(gtagCalls()).toContainEqual(["experiment_exposure", { experiment_id: "referral_invite_subject", variant_id: "specific_subject" }]);
      expect(screen.getByRole("link", { name: /check my exposure/i })).toHaveAttribute("href", "/scan?ref=ABCDEFGH");
    });

    it("a wrong or old private link says so and offers no form", async () => {
      vi.stubGlobal("fetch", vi.fn(async () => jsonResponse({ error: "This link is not valid" }, 403)));
      renderAt(`/invite#c=ABCDEFGH&t=${TOKEN}`);
      expect(await screen.findByRole("alert")).toHaveTextContent(/not valid or is out of date/i);
      expect(screen.queryByRole("button", { name: /send invitations/i })).not.toBeInTheDocument();
    });

    it("a failed send says nothing was sent", async () => {
      vi.stubGlobal("fetch", vi.fn(async (url: string) => (String(url).endsWith("/status") ? jsonResponse(STATUS) : jsonResponse({}, 500))));
      const user = userEvent.setup();
      renderAt(`/invite#c=ABCDEFGH&t=${TOKEN}`);
      await screen.findByLabelText("Your invitations");
      await user.type(screen.getByLabelText("Friend 1 email"), "one@example.com");
      await user.click(screen.getByRole("button", { name: /send invitations/i }));
      expect(await screen.findByRole("alert")).toHaveTextContent(/nothing was sent/i);
    });
  });
});
