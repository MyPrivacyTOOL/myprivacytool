/** PaPIT (Private and Portable Identity Tool) schema v1 — channel fragments. */

export type EngagementLevel = "lurker" | "occasional" | "active" | "power_user";
export type OverallTone = "positive" | "neutral" | "negative" | "mixed";
export type PostFrequency = "rare" | "weekly" | "daily" | "hyperactive";

export interface PaPITRedditBehavioral {
  source_channel: "reddit";
  behavioral: {
    interests: {
      communities: Array<{
        subreddit: string; // e.g. "r/privacy"
        engagement_level: EngagementLevel;
        topic_tags: string[]; // extracted keywords, never raw titles/bodies
      }>;
      top_topics: string[]; // aggregated across subreddits, max 20
    };
    sentiment: {
      overall_tone: OverallTone;
      controversial_engagement: boolean;
    };
    activity: {
      account_age_days: number;
      post_frequency: PostFrequency;
      comment_to_post_ratio: number;
    };
  };
  privacy_boundaries: {
    data_retention_days: 30;
    revocable: true;
    raw_content_stored: false;
  };
}
