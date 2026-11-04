# PaPIT JSON schema v1 (MPC-115)

PaPIT = Private and Portable Identity Tool profile. v1 is produced per channel; GitHub is the first
(`workers/github-channel/lib/papit.js`); Reddit (MPC-116) is the second (`lib/reddit-papit.js`) and emits the same envelope, see "Reddit channel" below.

```ts
interface PaPITProfile {
  version: "1.0";
  generated_at: string;                 // ISO 8601, UTC
  source_channel: "github";             // or "reddit" (see below)
  cryptographic_receipt: string;        // lowercase hex SHA-256 (see below)
  core_identity: {
    career: {
      skills: string[];                 // top <=10 languages across the user's own, non-fork, public repos, by repo count
      primary_role: string;             // fixed keyword rules (below); "Unspecified" if no public projects
      public_projects_count: number;    // GitHub profile public_repos
    };
  };
  behavioral: {
    interests: string[];                // top <=15 topics across starred repos, as [a-z0-9-] slugs, by frequency
    activity_level: "low" | "medium" | "high";
  };
  privacy_boundaries: {
    data_retention_days: 30;            // validity of this PaPIT snapshot. NOT token retention
    revocable: true;
  };
}
```

`core_identity` is produced by channels that expose durable facts (GitHub). A purely behavioral channel (Reddit) omits it.

## Derivations

| Field | Rule |
|---|---|
| `activity_level` | Public events in the last 90 days: `< 5` low, `5-50` medium, `> 50` high. GitHub's public events feed returns at most 300 events / 90 days; that is enough to cross the 50 threshold. |
| `primary_role` | Ordered keyword rules over the bio plus the top 3 languages and top 3 repo topics (word-bounded, case-insensitive): Security, Data/ML, DevOps/SRE, Mobile, Frontend, Backend, Full-Stack. Highest keyword count wins, rule order breaks ties. No match: `Software Developer` if the user has public repos, else `Unspecified`. No LLM. |
| `cryptographic_receipt` | SHA-256 over `JSON.stringify` of the profile **without** `cryptographic_receipt`, with object keys sorted alphabetically at every depth (arrays keep order). Hex-encoded. Lets a consumer detect any edit to the profile. |

## Privacy guarantees

- Built only from derived values: language names, topic slugs, counts, a role label.
- Never contains: email, real name, login/username, location, company, blog URL, avatar, profile URL, numeric id, or any bio text.
- The bio is read for keyword matching only and is not copied. Topics are normalised to `[a-z0-9-]` (max 40 chars), which also removes anything address- or name-shaped.
- Enforced by `workers/github-channel/test/papit.test.mjs` ("PII is stripped") and by the end-to-end Worker test.

## Versioning

Additive changes keep `version: "1.0"`. Removing or re-typing a field bumps the major version.

## Channel data bridge (MPC-113)

`workers/github-channel/lib/bridge.js` sits between channel ingestion and the PaPIT transformer:

1. **Classification** tags each ingested record `core_identity` (bio, repos, languages, employment, education,
   certifications, org membership), `ephemeral_behavioral` (a star, an event, a like, a post, a comment) or
   `restricted` (email, name, login, location, company, blog, avatar, profile URL, id, phone, address).
   Rules are fixed per record type; unknown types default to `ephemeral_behavioral`.
2. **Sanitization** drops `restricted` records and replaces URLs, emails, @handles, SSNs, card numbers, IPv4
   addresses and phone numbers in free text with `[redacted:<kind>]`.
3. **Export** runs `githubToPapit` on the sanitized records only. The PaPIT profile and its
   `cryptographic_receipt` are unchanged (schema stays v1.0).
4. **Sanitization receipt**: SHA-256 over the canonical JSON of `{rules_version, records_in/out/dropped,
   redactions, output_digest, papit_receipt}`. `GET /channels/github/profile` returns it in the
   `X-PaPIT-Sanitization-Receipt` header; `verifySanitizationReceipt()` re-checks it. It is a hash receipt,
   not a ZKP.

Rollback: revert `index.js` to call `githubToPapit` directly (the profile body is identical), and treat any
profile whose receipt header carries a withdrawn `rules_version` as invalid.

## Reddit channel (MPC-116)

Same envelope (`version`, `generated_at`, `source_channel: "reddit"`, `cryptographic_receipt`, `privacy_boundaries`), no `core_identity`.
`behavioral` keeps the two v1 base fields so a consumer reads Reddit and GitHub the same way, and adds Reddit detail under
`behavioral.reddit` (additive, so the version stays `1.0`):

```ts
interface PaPITRedditBehavioral {
  interests: string[];                  // top <=20 topic keywords across subreddits, [a-z-] only
  activity_level: "low" | "medium" | "high"; // comments + posts in the last 90 days, same thresholds as GitHub (<5, 5-50, >50)
  reddit: {
    communities: { subreddit: string;   // "r/privacy"
                   engagement_level: "lurker" | "occasional" | "active" | "power_user"; // items: <3, 3-9, 10-29, >=30
                   topic_tags: string[]; // <=5 keywords, never raw titles/bodies
                 }[];
    sentiment: { overall_tone: "positive" | "neutral" | "negative" | "mixed"; controversial_engagement: boolean };
    activity: { account_age_days: number; post_frequency: "rare" | "weekly" | "daily" | "hyperactive"; comment_to_post_ratio: number };
  };
}
// privacy_boundaries additionally carries raw_content_stored: false
```

Privacy: raw comment/post text exists only inside the transformer. It is first sanitized by the channel bridge (URLs, emails,
@handles, SSNs, cards, IPs, phones), then PII-stripped (zip codes, street addresses, "I live in ..." locations, `u/` mentions, the
user's own handle) and reduced to stopword-filtered keywords. The handle and account id are `restricted` records and are dropped
by the bridge. `GET /channels/reddit/behavior` returns the sanitization receipt in `X-PaPIT-Sanitization-Receipt` like GitHub does.
Enforced by `workers/github-channel/test/reddit-core.test.mjs` and `reddit-routes.test.mjs`.
