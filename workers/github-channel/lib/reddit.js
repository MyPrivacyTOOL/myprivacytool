/**
 * Reddit adapter (MPC-116): fetches the signed-in user's own account info, comments and submissions over
 * plain fetch (the snoowrap SDK is deprecated). Every call goes through the 1 req/s limiter. Raw text lives in
 * memory only: the transformer reduces it to keyword tags and the raw activity is never logged, cached or stored.
 */
import { createRateLimiter } from './rate-limit.js';
import { DEFAULT_USER_AGENT } from './reddit-oauth.js';

const API = 'https://oauth.reddit.com';
const sharedLimiter = createRateLimiter(); // one per isolate, so concurrent requests also share the budget

export class RedditAdapterError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

const subName = (s) => (typeof s === 'string' ? s : s?.display_name ?? s?.name ?? 'unknown');

export class RedditAdapter {
  constructor({ token, userAgent = DEFAULT_USER_AGENT, fetchFn = fetch, limiter = sharedLimiter }) {
    this.token = token;
    this.userAgent = userAgent;
    // Wrapped so `fetch` is never called as a method of this object (Workers: "Illegal invocation").
    this.fetchFn = (...args) => fetchFn(...args);
    this.limiter = limiter;
  }

  get(path) {
    return this.limiter(async () => {
      const res = await this.fetchFn(`${API}${path}`, {
        headers: { Authorization: `Bearer ${this.token}`, 'User-Agent': this.userAgent },
      });
      // Message carries the status only: never the URL, token or body.
      if (!res.ok) throw new RedditAdapterError(res.status, `reddit api ${res.status}`);
      return res.json();
    });
  }

  async listing(path) {
    return ((await this.get(path)).data?.children ?? []).map((c) => c.data);
  }

  /** @returns {Promise<object>} raw activity, held in memory only */
  async fetchActivity() {
    const me = await this.get('/api/v1/me');
    const name = encodeURIComponent(me.name);
    const comments = await this.listing(`/user/${name}/comments?limit=100&raw_json=1`);
    const submissions = await this.listing(`/user/${name}/submitted?limit=50&raw_json=1`);
    return {
      id: String(me.id),
      username: me.name,
      accountCreatedUtc: Number(me.created_utc ?? 0),
      totalKarma: me.total_karma ?? (me.link_karma ?? 0) + (me.comment_karma ?? 0),
      verified: Boolean(me.verified ?? me.has_verified_email),
      comments: comments.map((c) => ({
        subreddit: subName(c.subreddit),
        body: String(c.body ?? ''),
        score: Number(c.score ?? 0),
        controversiality: Number(c.controversiality ?? 0),
        createdUtc: Number(c.created_utc ?? 0),
      })),
      submissions: submissions.map((s) => ({
        subreddit: subName(s.subreddit),
        title: String(s.title ?? ''),
        score: Number(s.score ?? 0),
        createdUtc: Number(s.created_utc ?? 0),
      })),
    };
  }
}
