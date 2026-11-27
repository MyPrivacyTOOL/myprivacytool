// @vitest-environment node
// MPC-11569 (Telegram): the exposure-v2 Telegram scored set is tied to the REAL baseline scan code, so the two cannot drift apart.
import { describe, expect, it } from "vitest";
import { hexagonStates, riskFrom } from "./src/baseline-scan";
import { TELEGRAM_HEXAGONS } from "../../shared/hexagon-registry/channels.js";
import { TELEGRAM_NOT_SCORED, TELEGRAM_SCORED_IDS, telegramItems } from "../../shared/hexagon-registry/scoreV2Telegram.js";
import { OWNER_TEST_SNAPSHOT, WORST_ACCOUNT, MINIMAL_ACCOUNT, oldTelegramRisk } from "../../shared/hexagon-registry/scoreV2Telegram.fixtures.mjs";

// A synthetic chat that has EVERY field the baseline looks at, and a message that carries every A-class field. Never a real account.
const UPDATE = { update_id: 1, message: { message_id: 7, date: 1700000000, text: "Y", from: { id: 6000000001, is_bot: false, first_name: "T", last_name: "U", username: "t_user", language_code: "en" } } };
const FULL_CHAT: Record<string, unknown> = {
  id: 6000000001, first_name: "T", last_name: "U", username: "t_user", active_usernames: ["t_user", "t_two"], bio: "b", birthdate: { day: 1, month: 2 }, photo: { small_file_id: "x" },
  is_premium: true, emoji_status_custom_emoji_id: "1", profile_accent_color_id: 3, accent_color_id: 4, profile_background_custom_emoji_id: "2", accepted_gift_types: { unlimited_gifts: true },
  business_intro: { title: "t" }, business_location: { address: "a" }, business_opening_hours: { time_zone_name: "z" }, personal_chat: { id: 1 },
  has_private_forwards: true, has_restricted_voice_and_video_messages: true,
};
const PHOTOS = [[{ file_unique_id: "u1" }], [{ file_unique_id: "u2" }]];

describe("exposure-v2 Telegram scored set matches the real baseline scan", () => {
  it("the hexagons hexagonStates never evaluates (not_checked even for a complete account) are exactly the ones v2 does not score", () => {
    const states = hexagonStates(UPDATE, FULL_CHAT, PHOTOS);
    expect(states).toHaveLength(30);
    const neverEvaluated = states.filter((s) => s.state === "not_checked").map((s) => s.id).sort();
    expect(neverEvaluated).toEqual(Object.keys(TELEGRAM_NOT_SCORED).sort());
    expect(states.filter((s) => s.state !== "not_checked").map((s) => s.id).sort()).toEqual([...TELEGRAM_SCORED_IDS].sort());
  });

  it("an empty account is never 'not_checked' for a scored hexagon: the check ran and returned nothing", () => {
    const states = hexagonStates({ message: {} }, {}, []);
    for (const s of states) {
      if (TELEGRAM_SCORED_IDS.includes(s.id)) expect(s.state, s.id).toBe("not_returned");
      else expect(s.state, s.id).toBe("not_checked");
    }
  });

  it("the disabled hexagons in channels.js are all in the not-scored list, with their own reason", () => {
    for (const h of TELEGRAM_HEXAGONS.filter((x: { enabled: boolean }) => x.enabled === false)) expect(TELEGRAM_NOT_SCORED[h.id]).toContain((h as { disabledReason: string }).disabledReason);
  });

  it("the fixtures' old number equals the real riskFrom() (risk-count-1)", () => {
    for (const fx of [OWNER_TEST_SNAPSHOT, WORST_ACCOUNT, MINIMAL_ACCOUNT]) {
      const real = riskFrom(fx as never);
      const mine = oldTelegramRisk(fx);
      expect([mine.returned, mine.possible, mine.percent, mine.band]).toEqual([real.returned, real.possible, real.percent, real.band]);
    }
  });

  it("every state the baseline can produce maps to a score status (nothing silently dropped)", () => {
    const items = telegramItems(hexagonStates(UPDATE, FULL_CHAT, PHOTOS));
    expect(items).toHaveLength(30);
    expect(items.every((x) => ["found", "clear", "not_checked"].includes(x.status))).toBe(true);
  });
});
