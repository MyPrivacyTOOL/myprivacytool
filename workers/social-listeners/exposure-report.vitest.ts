// @vitest-environment node
// MPC-11622: the Telegram report and snapshot carry the tier-weighted exposure score (shared/exposure). Off by default (TELEGRAM_EXPOSURE_DISPLAY), stored either way.
import { describe, expect, it } from "vitest";
import { buildReport, exposureDisplayEnabled, hexagonStates } from "./src/baseline-scan";
import { TELEGRAM_EXPOSURE } from "../../shared/exposure/channels/telegram.js";
import type { Env } from "./src/shared";

const ID = 6000000001; // synthetic, never a real account
const yes = () => ({ update_id: 10, message: { message_id: 7, date: 1700000000, text: "Y", from: { id: ID, is_bot: false, first_name: "Test", language_code: "en" }, chat: { id: ID, type: "private" } } });
const ok = (r: unknown) => ({ status: 200, response: r });
const CHAT = { ok: true, result: { id: ID, type: "private", first_name: "Test", username: "t_user", bio: "hello", birthdate: { day: 1, month: 2 }, accent_color_id: ID % 7, photo: { small_file_id: "S", small_file_unique_id: "u1", big_file_id: "B", big_file_unique_id: "u2" } } };
const PHOTOS = { ok: true, result: { total_count: 1, photos: [[{ file_id: "P", file_unique_id: "u1", width: 160, height: 160 }]] } };

describe("exposure in the Telegram report (MPC-11622)", () => {
  it("is off unless TELEGRAM_EXPOSURE_DISPLAY is exactly on", () => {
    expect(exposureDisplayEnabled({} as Env)).toBe(false);
    expect(exposureDisplayEnabled({ TELEGRAM_EXPOSURE_DISPLAY: "true" } as unknown as Env)).toBe(false);
    expect(exposureDisplayEnabled({ TELEGRAM_EXPOSURE_DISPLAY: "on" } as unknown as Env)).toBe(true);
  });

  it("switch off: the text is the old risk-count-1 text, and the score is still computed for the snapshot", () => {
    const r = buildReport(yes(), ok(CHAT), ok(PHOTOS))!;
    expect(r.text).toMatch(/risk \(draft test report\): \d+ \/ 30 - (Low|Medium|High) exposure/);
    expect(r.text).not.toContain("Telegram exposure ");
    expect(r.exposure).toMatchObject({ method: "exposure-tier-1", status: "scored", scored: 25 });
    expect(r.risk.possible).toBe(30); // the old number is untouched
  });

  it("switch on: score and count side by side, the two parts of the bar, position, fix list with the total, and the version sentence", () => {
    const r = buildReport(yes(), ok(CHAT), ok(PHOTOS), null, { exposureDisplay: true })!;
    // the unit-test profile: 11 of 25 fields returned, tier weight 25 of 52 = 48 (fixture P08)
    expect(r.exposure.score).toBe(48);
    expect(r.text).toContain("Telegram exposure 48 · 11 of 25 fields returned");
    expect(r.text).toContain("Always sent: 29 of 100. This part is the platform, not your settings.");
    expect(r.text).toContain("Your settings: 19 more.");
    expect(r.text).toMatch(/lowest score possible is 35: 20% of the range you can change/);
    expect(r.text).toContain("What you can change: 19 points from 4 settings you can change. Biggest first:");
    expect(r.text).toMatch(/Birthday: 6 points\n {2}Profile photo: 6 points\n {2}Bio: 4 points/);
    expect(r.text).toContain("Your number reads 48 now instead of 37% because the score now weighs each of 25 fields");
    expect(r.text).toContain("(previous method: 11 of 30 = 37%)");
    expect(r.text).not.toMatch(/risk \(draft test report\)/);
    expect(r.text).not.toMatch(/Low exposure|Medium exposure|High exposure/); // the web bands are not valid for a channel with a floor
  });

  it("never calls a field that did not come back protected, clear, safe or fixed, and always says what a single scan cannot tell", () => {
    const r = buildReport(yes(), ok(CHAT), ok(PHOTOS), null, { exposureDisplay: true })!;
    const block = r.text.split("\n\n")[0] + r.text.split("\n\n")[1]; // the exposure block
    expect(block).not.toMatch(/\b(protected|clear|safe|fixed|hidden)\b/i);
    expect(r.text).toContain("This field did not come back in this scan. That can mean your settings hid it, or that you never filled it in - a single scan cannot tell the difference.");
    expect(r.text).not.toMatch(/\bprotected\b/i);
  });

  it("the stored exposure object is the shadow result: same facts, no report of effort, wizard or self-report", () => {
    const r = buildReport(yes(), ok(CHAT), ok(PHOTOS))!;
    expect(Object.keys(r.exposure).sort()).toEqual(expect.arrayContaining(["method", "score", "countText", "bar", "fixes", "position", "scopeVersion"]));
    expect(JSON.stringify(r.exposure)).not.toMatch(/self|wizard|intention|effort|bonus/i);
  });

  it("scope and worker agree: every scored Telegram field gets returned or not_returned from the baseline scan, never not_checked", () => {
    for (const chat of [CHAT.result, { id: ID, type: "private", first_name: "T" }]) {
      const states = hexagonStates(yes(), chat, []);
      for (const f of TELEGRAM_EXPOSURE.fields) expect(["returned", "not_returned"]).toContain(states.find((h) => h.id === f.id)?.state);
    }
  });

  it("the locked-down account scores lower than the public one, both through the report", () => {
    const locked = buildReport(yes(), ok({ ok: true, result: { id: ID, type: "private", first_name: "T" } }), ok({ ok: true, result: { total_count: 0, photos: [] } }))!;
    const full = buildReport(yes(), ok(CHAT), ok(PHOTOS))!;
    expect(locked.exposure.score!).toBeLessThan(full.exposure.score!);
    expect(locked.exposure.score!).toBeGreaterThanOrEqual(0);
  });
});
