import { render } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import type { ReactElement } from "react";

// MPC-7300: render a page inside the router context the real app provides.
export const renderPage = (ui: ReactElement, route = "/") => render(<MemoryRouter initialEntries={[route]}>{ui}</MemoryRouter>);

export const jsonResponse = (body: unknown, status = 200) =>
  ({ ok: status >= 200 && status < 300, status, json: async () => body, text: async () => JSON.stringify(body) }) as unknown as Response;
