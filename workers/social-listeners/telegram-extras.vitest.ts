// @vitest-environment node
// MPC-8689 pilot: the five extra Telegram hexagons are checked but stay outside the 30, the risk number and every score.
import { describe, expect, it } from "vitest";
import { buildReport, extraStates, hexagonStates, riskFrom } from "./src/baseline-scan";
import { TELEGRAM_EXTRA_IDS, TELEGRAM_EXTRA_HEXAGONS, TELEGRAM_HEXAGONS } from "../../shared/hexagon-registry/channels.js";

const ok = (result: unknown) => ({ status: 200, response: { ok: true, result } });
const update = (message: Record<string, unknown>) => ({ update_id: 1, message: { message_id: 1, date: 1, text: "hi", from: { id: 6000000001, first_name: "T", language_code: "en" }, chat: { id: 6000000001, type: "private" }, ...message } });
const chat = (over: Record<string, unknown> = {}) => ({ id: 6000000001, first_name: "T", ...over });
const state = (u: unknown, c: Record<string, unknown>, id: string) => extraStates(u, c).find((x) => x.id === id)?.state;

describe("extra Telegram hexagons", () => {
  it("are five, outside the 30, with ids that match the catalogue", () => {
    expect(TELEGRAM_EXTRA_HEXAGONS).toHaveLength(5);
    expect(TELEGRAM_HEXAGONS).toHaveLength(30);
    expect(TELEGRAM_EXTRA_IDS.filter((id) => TELEGRAM_HEXAGONS.some((x) => x.id === id))).toEqual([]);
  });
  it("are 'returned' only when the field is really there, and 'not_returned' otherwise (never invented)", () => {
    const plain = update({});
    for (const id of TELEGRAM_EXTRA_IDS) expect(state(plain, chat(), id)).toBe("not_returned");
    expect(state(update({ forward_origin: { type: "user" } }), chat(), "tg.forward_origin")).toBe("returned");
    expect(state(update({ is_from_offline: true }), chat(), "tg.offline_send")).toBe("returned");
    expect(state(update({ is_from_offline: false }), chat(), "tg.offline_send")).toBe("not_returned");
    expect(state(update({ reply_to_story: { id: 3 } }), chat(), "tg.story_reply")).toBe("returned");
    expect(state(update({ via_bot: { id: 1, is_bot: true } }), chat(), "tg.via_bot")).toBe("returned");
    expect(state(plain, chat({ first_profile_audio: { file_id: "x" } }), "tg.profile_audio")).toBe("returned");
  });
  it("do not change the risk number, the 30 states or the dashboard's hexagon list", () => {
    const u = update({ forward_origin: { type: "user" }, via_bot: { id: 1 } });
    const c = chat({ first_profile_audio: { file_id: "x" } });
    const withExtras = buildReport(u, ok(c), ok({ photos: [] }))!;
    const plain = buildReport(update({}), ok(chat()), ok({ photos: [] }))!;
    expect(withExtras.hexagons).toHaveLength(30);
    expect(withExtras.risk.possible).toBe(30);
    expect(withExtras.hexagons.map((x) => x.id)).toEqual(hexagonStates(u, c, []).map((x) => x.id));
    expect(withExtras.risk.returned).toBe(plain.risk.returned); // extras never raise or lower the count out of 30
    expect(riskFrom(withExtras.hexagons).possible).toBe(30);
    expect(withExtras.extras).toHaveLength(5);
    expect(withExtras.hexagons.some((x) => TELEGRAM_EXTRA_IDS.includes(x.id))).toBe(false);
  });
  it("show in the report as extra checks outside the number, listing only what was seen as seen", () => {
    const r = buildReport(update({ via_bot: { id: 1 } }), ok(chat()), ok({ photos: [] }))!;
    expect(r.text).toContain("Extra checks (not part of your number)");
    expect(r.text).toMatch(/Seen: Other bots used/);
    expect(r.text).toContain("Not in this message:");
  });
});
