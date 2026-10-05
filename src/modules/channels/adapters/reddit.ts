/* eslint-disable @typescript-eslint/no-explicit-any -- untyped snoowrap/test payloads */
import { withRateLimit } from "@/modules/channels/middleware/rate-limiter";

/** Raw activity held in memory only; the transformer reduces it to topic tags. */
export interface RedditActivity {
  username: string;
  accountCreatedUtc: number; // seconds
  totalKarma: number;
  verified: boolean;
  comments: Array<{ subreddit: string; body: string; score: number; controversiality: number }>;
  submissions: Array<{ subreddit: string; title: string; score: number; createdUtc: number }>;
}

/** The slice of snoowrap we use — lets tests inject a mock. */
export interface RedditClientLike {
  getMe(): PromiseLike<any>;
  getUser(name: string): {
    getComments(opts: { limit: number }): PromiseLike<any[]>;
    getSubmissions(opts: { limit: number }): PromiseLike<any[]>;
  };
}

const subName = (s: any): string => (typeof s === "string" ? s : s?.display_name ?? s?.name ?? "unknown");

export class RedditAdapter {
  constructor(private client: RedditClientLike) {}

  /** All Reddit calls go through the 1 req/sec limiter. */
  async fetchActivity(): Promise<RedditActivity> {
    const me: any = await withRateLimit(async () => this.client.getMe());
    const username: string = me.name;
    const user = this.client.getUser(username);
    const comments = await withRateLimit(async () => user.getComments({ limit: 100 }));
    const submissions = await withRateLimit(async () => user.getSubmissions({ limit: 50 }));

    return {
      username,
      accountCreatedUtc: me.created_utc,
      totalKarma: me.total_karma ?? (me.link_karma ?? 0) + (me.comment_karma ?? 0),
      verified: Boolean(me.verified ?? me.has_verified_email),
      comments: comments.map((c: any) => ({
        subreddit: subName(c.subreddit),
        body: String(c.body ?? ""),
        score: Number(c.score ?? 0),
        controversiality: Number(c.controversiality ?? 0),
      })),
      submissions: submissions.map((s: any) => ({
        subreddit: subName(s.subreddit),
        title: String(s.title ?? ""),
        score: Number(s.score ?? 0),
        createdUtc: Number(s.created_utc ?? 0),
      })),
    };
  }
}

/** Build a real snoowrap client from an OAuth token. Imported lazily (Node-only SDK). */
export async function createSnoowrapClient(opts: { userAgent: string; clientId: string; clientSecret: string; accessToken?: string; refreshToken?: string }): Promise<RedditClientLike> {
  const { default: Snoowrap } = await import("snoowrap");
  const r = new Snoowrap({
    userAgent: opts.userAgent,
    clientId: opts.clientId,
    clientSecret: opts.clientSecret,
    accessToken: opts.accessToken,
    refreshToken: opts.refreshToken,
  } as any);
  r.config({ requestDelay: 0, continueAfterRatelimitError: false, warnings: false });
  return r as unknown as RedditClientLike;
}
