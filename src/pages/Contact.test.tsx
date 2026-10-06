// MPC-7300: /contact form (the VITE_HUBSPOT_CONTACT_FORM_ID-unset mailto fallback and the HubSpot path).
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderPage, jsonResponse } from "@/test/render";

const fill = async (user: ReturnType<typeof userEvent.setup>) => {
  await user.type(screen.getByLabelText("Name"), "Ada Lovelace King");
  await user.type(screen.getByLabelText("Email"), "ada@example.com");
  await user.selectOptions(screen.getByLabelText("Topic"), "Press");
  await user.type(screen.getByLabelText("Message"), "Hello there");
  await user.click(screen.getByRole("checkbox"));
};

describe("Contact (HubSpot form configured)", () => {
  beforeEach(() => { vi.resetModules(); vi.stubEnv("VITE_HUBSPOT_CONTACT_FORM_ID", "contact-guid"); });
  afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

  it("submits the expected fields to HubSpot and shows the success state", async () => {
    const f = vi.fn(async () => jsonResponse({}));
    vi.stubGlobal("fetch", f);
    const { default: Contact } = await import("./Contact");
    const user = userEvent.setup();
    renderPage(<Contact />);
    await fill(user);
    await user.click(screen.getByRole("button", { name: /send message/i }));
    await screen.findByRole("button", { name: /message sent/i }); // success state; the page then redirects to /thank-you
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toContain("/submit/246502821/contact-guid");
    const fields = Object.fromEntries(JSON.parse(init.body as string).fields.map((x: { name: string; value: string }) => [x.name, x.value]));
    expect(fields).toMatchObject({
      firstname: "Ada", lastname: "Lovelace King", email: "ada@example.com", contact_topic: "Press",
      message: "Hello there", source_tag: "contact-page", consent_source: "contact_page",
    });
    expect(fields.consent_given_at).toMatch(/^\d+$/);
  });

  it("shows the error and keeps the form when HubSpot rejects", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse({ message: "Form not found" }, 404)));
    const { default: Contact } = await import("./Contact");
    const user = userEvent.setup();
    renderPage(<Contact />);
    await fill(user);
    await user.click(screen.getByRole("button", { name: /send message/i }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Form not found");
    expect(screen.getByRole("button", { name: /send message/i })).toBeEnabled();
  });

  it("shows a generic message for non-Error rejections", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw "offline"; }));
    const { default: Contact } = await import("./Contact");
    const user = userEvent.setup();
    renderPage(<Contact />);
    await fill(user);
    await user.click(screen.getByRole("button", { name: /send message/i }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Something went wrong");
  });

  it("requires consent before the browser lets the form submit", async () => {
    const f = vi.fn();
    vi.stubGlobal("fetch", f);
    const { default: Contact } = await import("./Contact");
    renderPage(<Contact />);
    expect(screen.getByRole("checkbox")).toBeRequired();
    expect(screen.getByRole("checkbox")).not.toBeChecked();
    expect(f).not.toHaveBeenCalled();
  });

  it("lists the direct email contacts", async () => {
    const { default: Contact } = await import("./Contact");
    renderPage(<Contact />);
    for (const e of ["privacy@", "dpo@", "legal@", "accessibility@"]) {
      expect(screen.getByRole("link", { name: new RegExp(`^${e}myprivacytool.io`) })).toHaveAttribute("href", expect.stringContaining(`mailto:${e}`));
    }
  });
});

describe("Contact (no form id: mailto fallback)", () => {
  afterEach(() => vi.unstubAllGlobals());
  it("opens a pre-filled mailto instead of calling HubSpot", async () => {
    vi.resetModules();
    const f = vi.fn();
    vi.stubGlobal("fetch", f);
    const loc = { href: "" };
    vi.stubGlobal("location", loc);
    const { default: Contact } = await import("./Contact");
    const user = userEvent.setup();
    renderPage(<Contact />);
    await fill(user);
    await user.click(screen.getByRole("button", { name: /send message/i }));
    await waitFor(() => expect(loc.href).toContain("mailto:privacy@myprivacytool.io"));
    expect(decodeURIComponent(loc.href)).toContain("[Press]");
    expect(f).not.toHaveBeenCalled();
  });
});
