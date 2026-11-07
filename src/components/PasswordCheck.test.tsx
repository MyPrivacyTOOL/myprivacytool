import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import PasswordCheck from "./PasswordCheck";
import * as lib from "@/lib/pwnedPassword";

afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); });

const type = (pw: string) => {
  fireEvent.change(screen.getByLabelText("Password to check"), { target: { value: pw } });
  fireEvent.click(screen.getByRole("button", { name: "Check" }));
};

describe("PasswordCheck", () => {
  it("renders nothing when the flag is off (default)", () => {
    const { container } = render(<PasswordCheck />);
    expect(container).toBeEmptyDOMElement();
  });

  it("shows the count and the fix checklist for an exposed password, and clears the field", async () => {
    vi.stubEnv("VITE_PASSWORD_CHECK", "true");
    const spy = vi.spyOn(lib, "checkPwnedPassword").mockResolvedValue({ status: "checked", count: 1234 });
    render(<PasswordCheck />);
    type("hunter2-test");
    await waitFor(() => expect(screen.getByText(/appeared 1,234 times/)).toBeInTheDocument());
    expect(screen.getByText(/two-factor/)).toBeInTheDocument();
    expect(spy).toHaveBeenCalledWith("hunter2-test");
    expect((screen.getByLabelText("Password to check") as HTMLInputElement).value).toBe("");
  });

  it("says a check error is not a safe result", async () => {
    vi.stubEnv("VITE_PASSWORD_CHECK", "true");
    vi.spyOn(lib, "checkPwnedPassword").mockResolvedValue({ status: "error", reason: "unreachable" });
    render(<PasswordCheck />);
    type("anything");
    await waitFor(() => expect(screen.getByText(/not a safe result/)).toBeInTheDocument());
  });
});
