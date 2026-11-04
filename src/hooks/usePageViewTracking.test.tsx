import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, render } from "@testing-library/react";
import { MemoryRouter, useNavigate } from "react-router-dom";
import { PAGE_VIEW_DELAY_MS, usePageViewTracking } from "./usePageViewTracking";

let gtag: ReturnType<typeof vi.fn>;
let go: (to: string) => void;

const Probe = () => {
  usePageViewTracking();
  const navigate = useNavigate();
  go = navigate;
  return null;
};

const pageViews = () => gtag.mock.calls.filter((c) => c[0] === "event" && c[1] === "page_view");

beforeEach(() => {
  vi.useFakeTimers();
  gtag = vi.fn();
  window.gtag = gtag;
  render(
    <MemoryRouter initialEntries={["/"]}>
      <Probe />
    </MemoryRouter>,
  );
});
afterEach(() => {
  vi.useRealTimers();
  delete window.gtag;
});

describe("usePageViewTracking (MPC-7376)", () => {
  it("does not report the initial page (gtag config already does)", () => {
    act(() => vi.advanceTimersByTime(PAGE_VIEW_DELAY_MS * 2));
    expect(pageViews()).toHaveLength(0);
  });

  it("reports one page_view per route change, after the title delay", () => {
    act(() => go("/pricing"));
    expect(pageViews()).toHaveLength(0);
    act(() => vi.advanceTimersByTime(PAGE_VIEW_DELAY_MS));
    expect(pageViews()).toHaveLength(1);
    act(() => go("/blog"));
    act(() => vi.advanceTimersByTime(PAGE_VIEW_DELAY_MS));
    expect(pageViews()).toHaveLength(2);
  });

  it("reports only the last page when navigation is faster than the delay", () => {
    act(() => go("/pricing"));
    act(() => go("/blog"));
    act(() => vi.advanceTimersByTime(PAGE_VIEW_DELAY_MS));
    expect(pageViews()).toHaveLength(1);
  });
});
