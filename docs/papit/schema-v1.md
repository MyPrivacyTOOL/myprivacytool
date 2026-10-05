# PaPIT schema v1 — channel fragments

Types live in `src/modules/papit/types.ts`.

## `reddit` (behavioral)
| Field | Type | Notes |
|---|---|---|
| `source_channel` | `"reddit"` | |
| `behavioral.interests.communities[]` | `{subreddit, engagement_level, topic_tags[]}` | `engagement_level`: lurker / occasional / active / power_user; tags are keywords, never titles |
| `behavioral.interests.top_topics` | `string[]` (≤20) | aggregated across subreddits |
| `behavioral.sentiment.overall_tone` | positive / neutral / negative / mixed | lexicon-based |
| `behavioral.sentiment.controversial_engagement` | boolean | ≥25% of comments downvoted/controversial |
| `behavioral.activity` | `{account_age_days, post_frequency, comment_to_post_ratio}` | frequency: rare / weekly / daily / hyperactive |
| `privacy_boundaries` | `{data_retention_days: 30, revocable: true, raw_content_stored: false}` | constant |
