import "@testing-library/jest-dom/vitest";

// MPC-9888: tests of the scan forms assume the visitor already pressed the consent button, as in the real flow (the form cannot send without it).
// Seeded before every test; the consent tests themselves reset it (src/lib/scanConsent.test.ts).
import { beforeEach } from "vitest";
import { __seedScanConsentForTests } from "../lib/scanConsent";
beforeEach(() => { __seedScanConsentForTests(); });
