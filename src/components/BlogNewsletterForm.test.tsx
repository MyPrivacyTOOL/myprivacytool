import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import BlogNewsletterForm from "./BlogNewsletterForm";

const subscribe = vi.hoisted(() => vi.fn());
const track = vi.hoisted(() => vi.fn());
vi.mock("@/lib/blogSubscribe", async (orig) => ({ ...(await orig<typeof import("@/lib/blogSubscribe")>()), subscribeToBlogNewsletter: subscribe }));
vi.mock("@/lib/analytics", () => ({ trackBlogLeadCapture: track }));

const fill = (email: string, tick = true) => {
  fireEvent.change(screen.getByLabelText("Email address"), { target: { value: email } });
  if (tick) fireEvent.click(screen.getByLabelText(/Email me Privacy Check/));
  fireEvent.click(screen.getByRole("button", { name: /subscribe/i }));
};

describe("BlogNewsletterForm", () => {
  beforeEach(() => { subscribe.mockReset(); track.mockReset(); });
  it("rejects an invalid email with a visible message and sends nothing", () => {
    render(<BlogNewsletterForm />); fill("not-an-email");
    expect(screen.getByRole("alert").textContent).toMatch(/valid email/);
    expect(subscribe).not.toHaveBeenCalled(); expect(track).not.toHaveBeenCalled();
  });
  it("needs the consent box", () => {
    render(<BlogNewsletterForm />); fill("a@b.co", false);
    expect(screen.getByRole("alert").textContent).toMatch(/tick the box/); expect(subscribe).not.toHaveBeenCalled();
  });
  it("shows success and fires blog_lead_capture after the save", async () => {
    subscribe.mockResolvedValue(undefined);
    render(<BlogNewsletterForm path="/blog" />); fill("a@b.co");
    await waitFor(() => expect(screen.getByTestId("blog-newsletter-success")).toBeTruthy());
    expect(subscribe).toHaveBeenCalledWith("a@b.co", "/blog"); expect(track).toHaveBeenCalledWith("/blog");
  });
  it("shows an error and no GA4 event when the save fails", async () => {
    subscribe.mockRejectedValue(new Error("We could not save your subscription."));
    render(<BlogNewsletterForm />); fill("a@b.co");
    await waitFor(() => expect(screen.getByRole("alert").textContent).toMatch(/could not save/));
    expect(track).not.toHaveBeenCalled();
  });
});
