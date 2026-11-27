// MPC-9824: /business/team (admin) and /business/join (employee). SYNTHETIC identities only (example.test). The Worker is a stub that applies the same rules as lib/business.js.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { screen, waitFor, render } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { jsonResponse } from "@/test/render";
import BusinessTeam from "./BusinessTeam";
import BusinessJoin from "./BusinessJoin";

const TEAM = "11111111-2222-4333-8444-555555555555";
const MEMBER = "66666666-7777-4888-8999-aaaaaaaaaaaa";
const TOKEN = "T".repeat(43);
const app = (route: string) => render(<MemoryRouter initialEntries={[route]}><Routes><Route path="/business/team" element={<BusinessTeam />} /><Route path="/business/join" element={<BusinessJoin />} /></Routes></MemoryRouter>);
const summary = (over: Record<string, unknown> = {}) => ({
  team_id: TEAM, company: "Quillfeather Ltd", counts: { invited_total: 3, awaiting: 1, authorised: 2, declined: 0, revoked: 0 },
  aggregate: { people_included: 2, people_with_a_listing: 1, pages_checked: 3, listed: 1, not_listed: 2, not_checked: 0 },
  members: [
    { member_id: MEMBER, email: "ada.test@example.test", status: "authorised", shared: true, detail: [{ name: "Spokeo", state: "listed" }] },
    { member_id: "m2", email: "bo.test@example.test", status: "authorised", shared: false, detail: null },
    { member_id: "m3", email: "cy.test@example.test", status: "invited", shared: false, detail: null },
  ], ...over,
});
function worker(routes: Record<string, (b: Record<string, unknown>, auth: string | null) => { status: number; body: unknown }>) {
  const calls: { path: string; body: Record<string, unknown>; auth: string | null }[] = [];
  vi.stubGlobal("fetch", vi.fn(async (url: unknown, init?: RequestInit) => {
    const path = String(url).split("/api/business/")[1];
    const body = init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : {};
    const auth = (init?.headers as Record<string, string> | undefined)?.Authorization ?? null;
    calls.push({ path, body, auth });
    const h = routes[path]; if (!h) return jsonResponse({}, 404);
    const r = h(body, auth); return jsonResponse(r.body, r.status);
  }));
  return calls;
}
const signedIn = () => localStorage.setItem("mpt_account_session", JSON.stringify({ accessToken: "at_1", refreshToken: "rt_1", expiresAt: 9999999999 }));

beforeEach(() => { localStorage.clear(); vi.stubEnv("VITE_ACCOUNTS_ENABLED", "true"); vi.stubEnv("VITE_BUSINESS_TEAMS_ENABLED", "true"); window.location.hash = ""; });
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

describe("/business/team", () => {
  it("is off (no calls) while either switch is not true", async () => {
    const calls = worker({}); vi.stubEnv("VITE_BUSINESS_TEAMS_ENABLED", "false"); signedIn();
    app("/business/team");
    expect(await screen.findByText(/not open yet/i)).toBeInTheDocument(); expect(calls).toHaveLength(0);
  });
  it("signed out: asks for a sign-in link and makes no business call", async () => {
    const calls = worker({}); app("/business/team");
    expect(await screen.findByTestId("team-signin")).toBeInTheDocument(); expect(calls).toHaveLength(0);
  });
  it("shows counts for the authorised people only, detail only where shared, and removes by member id", async () => {
    signedIn();
    const calls = worker({ summary: () => ({ status: 200, body: { teams: [{ team_id: TEAM, company: "Quillfeather Ltd" }], summary: summary() } }), "remove-member": () => ({ status: 200, body: { removed: true } }) });
    const user = userEvent.setup(); app("/business/team");
    expect(await screen.findByTestId("n-authorised")).toHaveTextContent("2");
    expect(screen.getByTestId("n-invited")).toHaveTextContent("3"); expect(screen.getByTestId("n-listed")).toHaveTextContent("1");
    expect(screen.getAllByTestId("member-row")).toHaveLength(3);
    expect(screen.getAllByTestId("member-detail")).toHaveLength(1);      // Ada shared; Bo did not; Cy has nothing
    expect(screen.getByText(/detail not shared/i)).toBeInTheDocument();
    await user.click(screen.getAllByRole("button", { name: "Remove" })[0]);
    await waitFor(() => expect(calls.some((c) => c.path === "remove-member" && c.body.member_id === MEMBER && c.body.team_id === TEAM)).toBe(true));
    expect(calls.every((c) => c.auth === "Bearer at_1")).toBe(true);
  });
  it("creates a team, invites by email list, and deletes with a confirm step", async () => {
    signedIn(); let created = false;
    const calls = worker({
      summary: () => ({ status: 200, body: created ? { teams: [{ team_id: TEAM, company: "Quillfeather Ltd" }], summary: summary({ members: [], counts: { invited_total: 0, awaiting: 0, authorised: 0, declined: 0, revoked: 0 } }) } : { teams: [], summary: null } }),
      team: () => { created = true; return { status: 200, body: { team_id: TEAM, company: "Quillfeather Ltd" } }; },
      invite: () => ({ status: 200, body: { invited: 3, sent: 3, skipped: 0 } }),
      "delete-team": () => ({ status: 200, body: { deleted: true } }),
    });
    const user = userEvent.setup(); app("/business/team");
    await user.type(await screen.findByLabelText("Company name"), "Quillfeather Ltd"); await user.click(screen.getByRole("button", { name: "Create team" }));
    await user.type(await screen.findByLabelText(/Invite by email/), "ada.test@example.test, bo.test@example.test\ncy.test@example.test");
    await user.click(screen.getByRole("button", { name: "Send invitations" }));
    await waitFor(() => expect(calls.find((c) => c.path === "invite")?.body.emails).toEqual(["ada.test@example.test", "bo.test@example.test", "cy.test@example.test"]));
    expect(await screen.findByText(/3 invited, 3 emails sent/)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Delete this team" }));
    expect(calls.some((c) => c.path === "delete-team")).toBe(false);          // needs the second press
    await user.click(screen.getByTestId("confirm-delete-team"));
    await waitFor(() => expect(calls.find((c) => c.path === "delete-team")?.body).toEqual({ team_id: TEAM, confirm: "delete" }));
  });
});

describe("/business/join", () => {
  it("opening the link only views the invitation: nothing is authorised", async () => {
    window.location.hash = `#t=${TOKEN}`;
    const calls = worker({ "join/view": () => ({ status: 200, body: { status: "invited", company: "Quillfeather Ltd", email: "ada.test@example.test", share_detail: false, results: [] } }) });
    app("/business/join");
    expect(await screen.findByTestId("authorise-form")).toBeInTheDocument();
    expect(screen.getByText(/nothing will be unless you press Authorise/i)).toBeInTheDocument();
    expect(calls.map((c) => c.path)).toEqual(["join/view"]); expect(calls[0].auth).toBeNull();
  });
  it("an unknown or missing token says so", async () => {
    worker({ "join/view": () => ({ status: 404, body: { error: "Invalid or expired" } }) });
    window.location.hash = `#t=${TOKEN}`; app("/business/join");
    expect(await screen.findByTestId("gone")).toBeInTheDocument();
  });
  it("Authorise sends consent, only what was typed, up to 3 pages and the share choice; then shows results, withdraw deletes", async () => {
    window.location.hash = `#t=${TOKEN}`; let status = "invited";
    const calls = worker({
      "join/view": () => ({ status: 200, body: status === "invited" ? { status, company: "Quillfeather Ltd", email: "ada.test@example.test", share_detail: false, results: [] } : status === "authorised" ? { status, company: "Quillfeather Ltd", email: "ada.test@example.test", share_detail: true, checked_at: "2026-11-15T01:00:00Z", results: [{ name: "Spokeo", state: "listed", evidence_url: "https://www.spokeo.com/profile/ada" }] } : { status, company: "Quillfeather Ltd", email: "ada.test@example.test", share_detail: false, results: [] } }),
      "join/authorise": () => { status = "authorised"; return { status: 200, body: { status: "authorised", company: "Quillfeather Ltd", results: [] } }; },
      "join/revoke": () => { status = "revoked"; return { status: 200, body: { ok: true } }; },
    });
    const user = userEvent.setup(); app("/business/join");
    await user.type(await screen.findByLabelText("Your name (optional)"), "Ada Quillfeather");
    await user.type(screen.getByLabelText("A page where you may be listed (optional)"), "https://www.spokeo.com/profile/ada");
    await user.click(screen.getByTestId("share-box")); await user.click(screen.getByTestId("authorise"));
    await waitFor(() => expect(calls.some((c) => c.path === "join/authorise")).toBe(true));
    const sent = calls.find((c) => c.path === "join/authorise")!.body;
    expect(sent).toEqual({ token: TOKEN, consent: true, share_detail: true, listing: { full_name: "Ada Quillfeather", urls: ["https://www.spokeo.com/profile/ada"] } });   // city and phone were not typed, so they are not sent
    expect(await screen.findByTestId("authorised-view")).toBeInTheDocument(); expect(screen.getByTestId("my-results")).toHaveTextContent("Spokeo: listed");
    await user.click(screen.getByTestId("revoke"));
    expect(await screen.findByTestId("revoked")).toBeInTheDocument();
    expect(calls.some((c) => c.path === "join/revoke")).toBe(true);
  });
  it("decline calls decline and nothing else is run", async () => {
    window.location.hash = `#t=${TOKEN}`; let status = "invited";
    const calls = worker({ "join/view": () => ({ status: 200, body: { status, company: "Q", email: "a@example.test", share_detail: false, results: [] } }), "join/decline": () => { status = "declined"; return { status: 200, body: { ok: true } }; } });
    const user = userEvent.setup(); app("/business/join");
    await user.click(await screen.findByTestId("decline"));
    expect(await screen.findByTestId("declined")).toBeInTheDocument();
    expect(calls.some((c) => c.path === "join/authorise")).toBe(false);
  });
});
