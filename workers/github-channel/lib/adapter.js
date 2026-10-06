/**
 * SocialPlatformAdapter interface + GitHubAdapter (MPC-115).
 *
 * Every Phase 1 channel (GitHub now, Reddit in MPC-116) implements:
 *   fetchIdentity() -> raw channel data that a papit transformer turns into a PaPIT profile.
 * The adapter only fetches; it never logs responses and never persists anything.
 *
 * Plain fetch is used instead of @octokit/rest on purpose: the repo's Workers are dependency-free
 * and only four read endpoints are needed. Rate limit: 5,000 req/h per user token; one cold
 * fetchIdentity() costs at most 1 + 3 + 2 + 3 = 9 requests, and results are cached 24h.
 */

const API = 'https://api.github.com';
const MAX_PAGES = { repos: 3, starred: 2, events: 3 };

export class SocialPlatformAdapter {
  /** @returns {Promise<object>} raw channel data (never logged) */
  // eslint-disable-next-line class-methods-use-this
  async fetchIdentity() { throw new Error('not implemented'); }
}

export class GitHubAdapterError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

export class GitHubAdapter extends SocialPlatformAdapter {
  constructor({ token, fetchFn = fetch }) {
    super();
    this.token = token;
    // Wrap so `fetch` is never invoked as a method of this object: Workers throws "Illegal invocation"
    // when the global fetch is called with a different `this`.
    this.fetchFn = (...args) => fetchFn(...args);
  }

  async get(path) {
    const res = await this.fetchFn(`${API}${path}`, {
      headers: {
        Authorization: `Bearer ${this.token}`,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        'User-Agent': 'myprivacytool-github-channel',
      },
    });
    // Message carries status only: never the URL query, token or body.
    if (!res.ok) throw new GitHubAdapterError(res.status, `github api ${res.status}`);
    return res.json();
  }

  async paged(path, maxPages) {
    const out = [];
    for (let page = 1; page <= maxPages; page++) {
      const sep = path.includes('?') ? '&' : '?';
      const items = await this.get(`${path}${sep}per_page=100&page=${page}`);
      out.push(...items);
      if (items.length < 100) break;
    }
    return out;
  }

  async fetchIdentity() {
    const profile = await this.get('/user');
    const [repos, starred, events] = await Promise.all([
      this.paged('/user/repos?visibility=public&affiliation=owner&sort=pushed', MAX_PAGES.repos),
      this.paged('/user/starred', MAX_PAGES.starred),
      this.paged(`/users/${encodeURIComponent(profile.login)}/events/public`, MAX_PAGES.events),
    ]);
    return { profile, repos, starred, events };
  }
}
