import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import Blog from "./Blog";
import BlogPost from "./BlogPost";

const analytics = vi.hoisted(() => ({
  trackBlogListView: vi.fn(),
  trackBlogPostClick: vi.fn(),
  trackBlogPostView: vi.fn(),
  trackBlogScrollDepth: vi.fn(),
  trackBlogCtaClick: vi.fn(),
}));

vi.mock("@/lib/analytics", () => analytics);
vi.mock("@/components/Seo", () => ({ default: () => null }));

const renderBlog = (route: string) =>
  render(
    <MemoryRouter initialEntries={[route]}>
      <Routes>
        <Route path="/blog" element={<Blog />} />
        <Route path="/blog/:slug" element={<BlogPost />} />
      </Routes>
    </MemoryRouter>,
  );

describe("blog GA4 tracking wiring", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.scrollTo = vi.fn();
  });

  it("reports one list view and a post click with the card position", () => {
    renderBlog("/blog");
    expect(analytics.trackBlogListView).toHaveBeenCalledTimes(1);
    expect(analytics.trackBlogListView).toHaveBeenCalledWith(8);

    fireEvent.click(screen.getAllByRole("link", { name: /read article/i })[1]);
    expect(analytics.trackBlogPostClick).toHaveBeenCalledTimes(1);
    const [slug, category, position] = analytics.trackBlogPostClick.mock.calls[0];
    expect(typeof slug).toBe("string");
    expect(typeof category).toBe("string");
    expect(position).toBe(2);
  });

  it("reports one post view with slug, category and read time", () => {
    renderBlog("/blog/how-exposed-are-you");
    expect(analytics.trackBlogPostView).toHaveBeenCalledTimes(1);
    expect(analytics.trackBlogPostView).toHaveBeenCalledWith("how-exposed-are-you", "Privacy Awareness", 8);
  });

  it("does not report a view for an unknown slug", () => {
    renderBlog("/blog/not-a-real-post");
    expect(analytics.trackBlogPostView).not.toHaveBeenCalled();
    expect(screen.getByText(/article not found/i)).toBeInTheDocument();
  });

  it("counts the end-of-post scan CTA with its location", () => {
    renderBlog("/blog/how-exposed-are-you");
    fireEvent.click(screen.getByRole("link", { name: /check my exposure/i }));
    expect(analytics.trackBlogCtaClick).toHaveBeenCalledTimes(1);
    expect(analytics.trackBlogCtaClick).toHaveBeenCalledWith("how-exposed-are-you", "end_of_post", "/scan");
  });

  it("counts the newsletter card with its location", () => {
    renderBlog("/blog/how-exposed-are-you");
    fireEvent.click(screen.getByRole("link", { name: /subscribe now/i }));
    expect(analytics.trackBlogCtaClick).toHaveBeenCalledTimes(1);
    expect(analytics.trackBlogCtaClick).toHaveBeenCalledWith("how-exposed-are-you", "newsletter_card", "/newsletter");
  });

  it("does not count the share buttons as CTAs", () => {
    Object.assign(navigator, { clipboard: { writeText: vi.fn() } });
    vi.spyOn(window, "alert").mockImplementation(() => {});
    renderBlog("/blog/how-exposed-are-you");
    fireEvent.click(screen.getByRole("button", { name: /copy link/i }));
    expect(analytics.trackBlogCtaClick).not.toHaveBeenCalled();
  });

  it("reports scroll depth once per threshold as the article scrolls into view", () => {
    renderBlog("/blog/how-exposed-are-you");
    const article = document.querySelector(".article-lg") as HTMLElement;
    expect(article).not.toBeNull();
    // jsdom has no layout: fake a 1000px tall article and move it up the viewport (innerHeight is 768).
    let top = 700;
    article.getBoundingClientRect = () =>
      ({ top, height: 1000, bottom: top + 1000, left: 0, right: 0, width: 0, x: 0, y: top, toJSON: () => ({}) }) as DOMRect;

    fireEvent.scroll(window); // 68 px seen of 1000 -> nothing yet
    expect(analytics.trackBlogScrollDepth).not.toHaveBeenCalled();

    top = 300; // 468 seen -> 46% -> 25
    fireEvent.scroll(window);
    expect(analytics.trackBlogScrollDepth.mock.calls).toEqual([["how-exposed-are-you", 25]]);

    top = -100; // 868 seen -> 86% -> 50, 75
    fireEvent.scroll(window);
    fireEvent.scroll(window); // repeated scrolls must not repeat events
    expect(analytics.trackBlogScrollDepth.mock.calls).toEqual([
      ["how-exposed-are-you", 25],
      ["how-exposed-are-you", 50],
      ["how-exposed-are-you", 75],
    ]);

    top = -400; // fully seen -> 100
    fireEvent.scroll(window);
    expect(analytics.trackBlogScrollDepth).toHaveBeenLastCalledWith("how-exposed-are-you", 100);
    expect(analytics.trackBlogScrollDepth).toHaveBeenCalledTimes(4);
  });
});
