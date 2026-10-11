// MPC-7488: the visitor is shown their scan number with one plain line saying what it is for.
import { describe, it, expect, beforeEach } from "vitest";
import { render, screen, act } from "@testing-library/react";
import ScanNumberNotice from "./ScanNumberNotice";
import { SCAN_NUMBER_EVENT } from "@/lib/webScan";

const NUMBER = "11111111-2222-4333-8444-555555555555";
beforeEach(() => { sessionStorage.clear(); localStorage.clear(); });

describe("ScanNumberNotice", () => {
  it("shows nothing when no scan was saved", () => {
    render(<ScanNumberNotice />);
    expect(screen.queryByTestId("scan-number-notice")).toBeNull();
  });

  it("shows the number and what it is for as soon as the scan is saved", () => {
    render(<ScanNumberNotice />);
    act(() => {
      sessionStorage.setItem("mpt_web_scan_number", NUMBER);
      localStorage.setItem("mpt_web_scan_number", NUMBER);
      window.dispatchEvent(new CustomEvent(SCAN_NUMBER_EVENT, { detail: NUMBER }));
    });
    expect(screen.getByTestId("scan-number").textContent).toBe(NUMBER);
    expect(screen.getByText("Quote this number if you want this scan deleted.")).toBeTruthy();
    expect(screen.getByText("Your scan number")).toBeTruthy();
  });

  it("labels a number from an earlier visit on this device as the last saved scan", () => {
    localStorage.setItem("mpt_web_scan_number", NUMBER);
    render(<ScanNumberNotice />);
    expect(screen.getByText(/last saved scan number/i)).toBeTruthy();
    expect(screen.getByTestId("scan-number").textContent).toBe(NUMBER);
  });
});
