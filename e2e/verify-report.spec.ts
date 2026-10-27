// MPC-8281: /verify-report in a real browser. The API is stubbed; what this proves is the part jsdom cannot: a real file chosen through
// the real file input is read, sent as the right request, and the answer is shown in plain words.
import { test, expect } from "./fixtures";

const signed = { report: { report_id: "r1" }, signature: { alg: "Ed25519", issuer: "MyPrivacyTOOL", signed_at: "2026-10-26T00:00:00.000Z", public_key: "k", value: "v" } };

test.describe("/verify-report", () => {
  test("is not indexed and cannot check until a file is chosen", async ({ page }) => {
    await page.goto("/verify-report");
    await expect(page.getByRole("heading", { level: 1 })).toContainText("Check a signed report");
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", /noindex/);
    await expect(page.getByTestId("check-report")).toBeDisabled();
  });

  test("a chosen signed file is sent to the checker and a verified answer is shown", async ({ page }) => {
    let sent: unknown;
    await page.route("**/api/verify-report", async (route) => {
      sent = route.request().postDataJSON();
      await route.fulfill({ json: { verified: true, signature_valid: true, issuer_key_trusted: true, signed_at: signed.signature.signed_at } });
    });
    await page.goto("/verify-report");
    await page.getByTestId("report-files").setInputFiles({ name: "r.signed.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(signed)) });
    await page.getByTestId("check-report").click();
    await expect(page.getByTestId("verdict")).toContainText("Verified. This file was signed by MyPrivacyTOOL on 2026-10-26");
    expect(sent).toEqual(signed);
  });

  test("a PDF is sent as base64 with its signature, and a changed PDF is refused with a reason", async ({ page }) => {
    let sent: { pdf_base64?: string; signature?: unknown } = {};
    await page.route("**/api/verify-report", async (route) => {
      sent = route.request().postDataJSON();
      await route.fulfill({ json: { verified: false, signature_valid: true, file_matches: false, issuer_key_trusted: true } });
    });
    await page.goto("/verify-report");
    const sig = { file: "r.pdf", signature: { sha256: "h", value: "v", public_key: "k", signed_at: "t", issuer: "MyPrivacyTOOL" } };
    await page.getByTestId("report-files").setInputFiles([
      { name: "r.pdf", mimeType: "application/pdf", buffer: Buffer.from("%PDF-1.4 hello") },
      { name: "r.pdf.sig.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(sig)) },
    ]);
    await page.getByTestId("check-report").click();
    await expect(page.getByTestId("verdict")).toContainText("Not verified.");
    await expect(page.getByTestId("verdict")).toContainText("not the one the signature was made for");
    expect(Buffer.from(sent.pdf_base64 ?? "", "base64").toString()).toBe("%PDF-1.4 hello");
    expect(sent.signature).toEqual(sig.signature);
  });

  test("an unreachable checker gives a plain message", async ({ page }) => {
    await page.route("**/api/verify-report", (route) => route.abort());
    await page.goto("/verify-report");
    await page.getByTestId("report-files").setInputFiles({ name: "r.signed.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(signed)) });
    await page.getByTestId("check-report").click();
    await expect(page.getByTestId("verdict")).toContainText("could not reach the checker");
  });
});
