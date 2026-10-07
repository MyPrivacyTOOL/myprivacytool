// MPC-7503: tell the Make.com distribution scenario that a blog post is live.
// Usage: MAKE_DISTRIBUTION_WEBHOOK_URL=... node scripts/notify-make-distribution.mjs <slug> [subreddit] [campaign] [--dry-run]
// The webhook URL is a secret; never commit it.
import { readFileSync } from "node:fs";

const SITE_URL = "https://www.myprivacytool.io";
const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const [slug, subreddit = "privacy", campaign = "mpc-7503"] = args.filter((a) => a !== "--dry-run");
if (!slug) {
  console.error("usage: notify-make-distribution.mjs <slug> [subreddit] [campaign] [--dry-run]");
  process.exit(2);
}

const posts = JSON.parse(readFileSync(new URL("../src/data/blogPosts.json", import.meta.url), "utf8"));
const post = posts.find((p) => p.slug === slug);
if (!post) {
  console.error(`No blog post with slug "${slug}" in src/data/blogPosts.json`);
  process.exit(1);
}

const payload = { slug, title: post.title, excerpt: post.excerpt, url: `${SITE_URL}/blog/${slug}`, subreddit, campaign };

if (dryRun) {
  console.log(JSON.stringify(payload, null, 2));
  process.exit(0);
}

const hook = process.env.MAKE_DISTRIBUTION_WEBHOOK_URL;
if (!hook) {
  console.error("MAKE_DISTRIBUTION_WEBHOOK_URL is not set");
  process.exit(2);
}
const res = await fetch(hook, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload) });
console.log(`Make webhook responded ${res.status}`);
if (!res.ok) process.exit(1);
