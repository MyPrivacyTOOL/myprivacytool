// MPC-7465: /scan carries the anonymous scan number to the Worker, and works without one.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderPage, jsonResponse } from "@/test/render";
import Scan from "./Scan";

const NUMBER = "11111111-2222-4333-8444-555555555555";
beforeEach(() => { window.scrollTo = vi.fn() as unknown as typeof window.scrollTo; sessionStorage.clear(); });
afterEach(() => vi.unstubAllGlobals());

async function submit() {
  const f = vi.fn(async (..._args: unknown[]) => jsonResponse({}));
  vi.stubGlobal("fetch", f);
  const user = userEvent.setup();
  renderPage(<Scan />);
  await user.type(screen.getAllByLabelText("Email address")[0], "mpc7465+site@example.com");
  await user.click(screen.getAllByRole("checkbox")[0]);
  await user.click(screen.getAllByRole("button", { name: /check my exposure/i })[0]);
  await screen.findByRole("status");
  const call = f.mock.calls.find((c: unknown[]) => String(c[0]).endsWith("/api/scan")) as unknown as [string, RequestInit];
  return { call, body: JSON.parse(call[1].body as string) };
}

describe("Scan page and the scan number", () => {
  it("sends the scan number with the email when this visit saved a scan", async () => {
    sessionStorage.setItem("mpt_web_scan_number", NUMBER);
    const { body } = await submit();
    expect(body).toMatchObject({ email: "mpc7465+site@example.com", consent: true, scan_number: NUMBER });
  });

  it("with no scan number the email still goes through, without one", async () => {
    const { body } = await submit();
    expect(body.email).toBe("mpc7465+site@example.com");
    expect("scan_number" in body).toBe(false);
  });

  it("ignores a malformed stored scan number", async () => {
    sessionStorage.setItem("mpt_web_scan_number", "<script>");
    const { body } = await submit();
    expect("scan_number" in body).toBe(false);
  });
});
