import type { RedditActivity } from "@/modules/channels/adapters/reddit";
import type { EngagementLevel, OverallTone, PaPITRedditBehavioral, PostFrequency } from "@/modules/papit/types";

const DAY = 86400;
const MAX_TAGS_PER_SUB = 5;
const MAX_TOP_TOPICS = 20;

/** Remove self-disclosed PII and user mentions before any analysis. */
export function stripPii(text: string, username?: string): string {
  let t = text
    .replace(/[\w.+-]+@[\w-]+(\.[\w-]+)+/g, " ") // emails
    .replace(/(?:\+?\d{1,3}[\s.-]?)?(?:\(\d{3}\)|\d{3})[\s.-]?\d{3}[\s.-]?\d{4}\b/g, " ") // phone numbers
    .replace(/\b\d{5}(?:-\d{4})?\b/g, " ") // US zip codes
    .replace(/\b\d{1,5}\s+(?:[A-Z][a-z]+\s+){1,3}(?:Street|St|Avenue|Ave|Road|Rd|Boulevard|Blvd|Lane|Ln|Drive|Dr)\b\.?/g, " ") // street addresses
    .replace(/\b(?:i live in|i'm from|i am from|im from|i'm located in|located in|based in|living in|i reside in)\s+(?:[A-Z][\w'-]+(?:,?\s+[A-Z][\w'-]+){0,3})/gi, " ") // locations
    .replace(/\/?\bu\/[\w-]+/gi, " "); // usernames
  if (username) t = t.replace(new RegExp(`\\b${username.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "gi"), " ");
  return t;
}

const STOPWORDS = new Set(
  "about above after again also always because been before being between both bring could does doing done down during each even every from further gets going good great have having here http https into just keep know like make many might more most much must never only other over really right same should since some still such than that their them then there these they thing things think this those through very want well were what when where which while will with would your youre dont cant isnt thats ive lol edit yeah people anyone something someone".split(" "),
);

export function extractKeywords(text: string, limit = MAX_TAGS_PER_SUB): string[] {
  const counts = new Map<string, number>();
  for (const w of text.toLowerCase().match(/[a-z][a-z-]{3,}/g) ?? []) {
    if (STOPWORDS.has(w)) continue;
    counts.set(w, (counts.get(w) ?? 0) + 1);
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, limit)
    .map(([w]) => w);
}

export function classifyEngagement(count: number): EngagementLevel {
  if (count >= 30) return "power_user";
  if (count >= 10) return "active";
  if (count >= 3) return "occasional";
  return "lurker";
}

export function classifyPostFrequency(submissionTimestamps: number[], nowSec: number): PostFrequency {
  if (submissionTimestamps.length === 0) return "rare";
  const spanDays = Math.max(30, (nowSec - Math.min(...submissionTimestamps)) / DAY);
  const perDay = submissionTimestamps.length / spanDays;
  if (perDay >= 3) return "hyperactive";
  if (perDay >= 0.5) return "daily";
  if (perDay >= 1 / 14) return "weekly";
  return "rare";
}

const POSITIVE = new Set("great love awesome thanks thank helpful amazing good excellent nice best happy glad enjoy recommend".split(" "));
const NEGATIVE = new Set("hate terrible awful bad worst stupid useless annoying broken scam angry sucks horrible garbage wrong".split(" "));

function classifyTone(texts: string[]): OverallTone {
  let pos = 0, neg = 0;
  for (const t of texts) for (const w of t.toLowerCase().match(/[a-z]+/g) ?? []) {
    if (POSITIVE.has(w)) pos++; else if (NEGATIVE.has(w)) neg++;
  }
  if (pos + neg < 3) return "neutral";
  const ratio = pos / (pos + neg);
  if (ratio >= 0.7) return "positive";
  if (ratio <= 0.3) return "negative";
  return "mixed";
}

export function transformRedditActivity(a: RedditActivity, nowSec = Math.floor(Date.now() / 1000)): PaPITRedditBehavioral {
  const bySub = new Map<string, { count: number; text: string[] }>();
  const add = (sub: string, text: string) => {
    const key = `r/${sub.replace(/^r\//, "")}`;
    const entry = bySub.get(key) ?? { count: 0, text: [] };
    entry.count++;
    entry.text.push(stripPii(text, a.username)); // raw text lives only in this local scope
    bySub.set(key, entry);
  };
  a.comments.forEach((c) => add(c.subreddit, c.body));
  a.submissions.forEach((s) => add(s.subreddit, s.title));

  const ranked = [...bySub.entries()].sort((x, y) => y[1].count - x[1].count || x[0].localeCompare(y[0]));
  const communities = ranked.map(([subreddit, { count, text }]) => ({
    subreddit,
    engagement_level: classifyEngagement(count),
    topic_tags: extractKeywords(text.join(" ")),
  }));

  const topCounts = new Map<string, number>();
  communities.forEach((c, i) => c.topic_tags.forEach((t) => topCounts.set(t, (topCounts.get(t) ?? 0) + ranked[i][1].count)));
  const top_topics = [...topCounts.entries()].sort((x, y) => y[1] - x[1] || x[0].localeCompare(y[0])).slice(0, MAX_TOP_TOPICS).map(([t]) => t);

  const heated = a.comments.filter((c) => c.controversiality > 0 || c.score < 0).length;
  const ratio = a.submissions.length === 0 ? a.comments.length : a.comments.length / a.submissions.length;

  return {
    source_channel: "reddit",
    behavioral: {
      interests: { communities, top_topics },
      sentiment: {
        overall_tone: classifyTone([...ranked.flatMap(([, v]) => v.text)]),
        controversial_engagement: a.comments.length > 0 && heated / a.comments.length >= 0.25,
      },
      activity: {
        account_age_days: Math.max(0, Math.floor((nowSec - a.accountCreatedUtc) / DAY)),
        post_frequency: classifyPostFrequency(a.submissions.map((s) => s.createdUtc), nowSec),
        comment_to_post_ratio: Math.round(ratio * 100) / 100,
      },
    },
    privacy_boundaries: { data_retention_days: 30, revocable: true, raw_content_stored: false },
  };
}
