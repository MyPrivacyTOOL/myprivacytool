// @vitest-environment node
import { describe, it, expect } from "vitest";
import { transformRedditActivity, stripPii, classifyEngagement, classifyPostFrequency } from "../reddit";
import type { RedditActivity } from "@/modules/channels/adapters/reddit";

const NOW = 1_800_000_000;
const DAY = 86400;

const activity: RedditActivity = {
  username: "secret_handle",
  accountCreatedUtc: NOW - 400 * DAY,
  totalKarma: 1234,
  verified: true,
  comments: [
    { subreddit: "privacy", body: "UNIQUE_RAW_BODY_MARKER encryption encryption metadata. Email me at jane@example.com or call 555-123-4567. I live in Springfield Illinois.", score: 5, controversiality: 0 },
    { subreddit: "privacy", body: "Thanks u/someone, great encryption tooling, love it", score: 3, controversiality: 0 },
    { subreddit: "privacy", body: "secret_handle here: awesome tracking protection", score: 2, controversiality: 0 },
    { subreddit: "typescript", body: "generics inference helpful", score: 1, controversiality: 0 },
  ],
  submissions: [{ subreddit: "privacy", title: "UNIQUE_RAW_TITLE_MARKER browser fingerprinting study", score: 10, createdUtc: NOW - 10 * DAY }],
};

describe("transformRedditActivity", () => {
  const out = transformRedditActivity(activity, NOW);
  const dump = JSON.stringify(out);

  it("Verify raw post body is never present in PaPIT output", () => {
    expect(dump).not.toContain("UNIQUE_RAW_BODY_MARKER");
    expect(dump).not.toContain("UNIQUE_RAW_TITLE_MARKER");
    expect(dump).not.toContain("Email me at");
    expect(out.privacy_boundaries).toEqual({ data_retention_days: 30, revocable: true, raw_content_stored: false });
  });

  it("emits only short topic keywords", () => {
    const privacy = out.behavioral.interests.communities.find((c) => c.subreddit === "r/privacy")!;
    expect(privacy.topic_tags).toContain("encryption");
    privacy.topic_tags.forEach((t) => expect(t).toMatch(/^[a-z-]+$/));
    expect(out.behavioral.interests.top_topics.length).toBeLessThanOrEqual(20);
  });

  it("keeps PII and the username out of the output", () => {
    for (const leak of ["jane", "example.com", "555", "Springfield", "secret_handle", "someone"]) {
      expect(dump.toLowerCase()).not.toContain(leak.toLowerCase());
    }
  });

  it("computes activity fields", () => {
    expect(out.behavioral.activity.account_age_days).toBe(400);
    expect(out.behavioral.activity.comment_to_post_ratio).toBe(4);
    expect(out.behavioral.sentiment.overall_tone).toBe("positive");
  });
});

describe("stripPii", () => {
  it("Verify PII regex strips email addresses from comment summaries", () => {
    expect(stripPii("reach me: a.b+c@mail.example.co.uk ok")).not.toMatch(/@|mail\.example/);
  });
  it("strips phone numbers", () => {
    for (const p of ["555-123-4567", "(555) 123-4567", "+1 555 123 4567", "555.123.4567"]) {
      expect(stripPii(`call ${p} now`)).not.toMatch(/\d{3}/);
    }
  });
  it("strips location patterns", () => {
    expect(stripPii("I live in Portland Oregon and love it")).not.toContain("Portland");
    expect(stripPii("based in Berlin, Germany")).not.toContain("Berlin");
    expect(stripPii("zip 94107 here")).not.toContain("94107");
    expect(stripPii("at 221 Baker Street today")).not.toContain("Baker");
  });
  it("strips user mentions", () => {
    expect(stripPii("hi u/foo-bar and /u/baz")).not.toMatch(/foo|baz/);
  });
});

describe("classification", () => {
  it("engagement levels", () => {
    expect([0, 2, 3, 9, 10, 29, 30, 200].map(classifyEngagement)).toEqual([
      "lurker", "lurker", "occasional", "occasional", "active", "active", "power_user", "power_user",
    ]);
  });
  it("post frequency", () => {
    const ts = (n: number, spanDays: number) => Array.from({ length: n }, (_, i) => NOW - (i * spanDays * DAY) / n);
    expect(classifyPostFrequency([], NOW)).toBe("rare");
    expect(classifyPostFrequency(ts(1, 200), NOW)).toBe("rare");
    expect(classifyPostFrequency(ts(10, 70), NOW)).toBe("weekly");
    expect(classifyPostFrequency(ts(50, 50), NOW)).toBe("daily");
    expect(classifyPostFrequency(ts(200, 40), NOW)).toBe("hyperactive");
  });
});
