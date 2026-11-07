// The data-deletion instructions page (the URL Meta asks for). Its wording restates the Privacy Policy; these checks keep the two aligned.
import { describe, it, expect } from "vitest";
import { screen } from "@testing-library/react";
import { renderPage } from "@/test/render";
import pageMeta from "@/data/pageMeta.json";
import DataDeletion from "./DataDeletion";
import Privacy from "./Privacy";

const flat = (s: string) => s.replace(/\s+/g, " ").trim();

describe("DataDeletion", () => {
  it("has a heading, the deletion mailbox, the Telegram self-service steps and the 30-day reply", () => {
    renderPage(<DataDeletion />);
    expect(screen.getByRole("heading", { level: 1, name: "How to delete your data" })).toBeInTheDocument();
    const mail = screen.getAllByRole("link", { name: "privacy@myprivacytool.io" })[0];
    expect(mail).toHaveAttribute("href", "mailto:privacy@myprivacytool.io");
    const text = flat(document.body.textContent ?? "");
    expect(text).toContain("send STOP, or tap “Delete my scan data” in the /fix list");
    expect(text).toContain("We will respond within 30 days.");
    expect(screen.getByRole("link", { name: "Privacy Policy" })).toHaveAttribute("href", "/privacy");
  });

  it("uses the same mailbox, the same Telegram actions and the same 30-day reply as the Privacy Policy", () => {
    renderPage(<Privacy />);
    const policy = flat(document.body.textContent ?? "");
    expect(policy).toContain("privacy@myprivacytool.io");
    expect(policy).toContain("send STOP, or tap “Delete my scan data” in the /fix list");
    expect(policy).toContain("We will respond within 30 days.");
  });

  it("has page metadata, which also puts it in the prerendered pages", () => {
    const meta = (pageMeta as Record<string, { title: string; description: string }>)["/data-deletion"];
    expect(meta.title).toMatch(/delete/i);
    expect(meta.description.length).toBeGreaterThan(40);
  });
});
