# Brief for counsel: edge request logging (MPC-6798)

Prepared by Claude for Chris Ransford, 2026-10-12. Not legal advice. Wording is live at https://myprivacytool.io/privacy, sections 2.3 and 6 (source: `src/pages/Privacy.tsx`).

## What the site does
Every page request (HTML pages, robots.txt, sitemap, API calls; not images, fonts or bundles) is logged at the edge: time, path without query string, method, response code, user agent, IP address, country, network name, referrer (site and page only), a short allow-list of browser headers. Never cookies or credentials. Nothing is blocked or challenged.
Each request is sorted by a versioned rule list into person, bot, AI or unknown. Unknown is treated as a person. Bot and AI rows are kept in full. For person and unknown rows the IP address is set to empty after 30 days (one setting); the rest of the row stays. A person can ask for deletion of a visit.
A browser-looking request with the usual browser headers missing is sorted as unknown (so its IP is cut), not as a bot.

## Questions
1. Is 30 days a defensible period for IP addresses in server logs, for visitors in Hong Kong, the UK and the EU?
2. Is it acceptable to treat "unknown" as a person and cut its IP at 30 days?
3. Do we need to state a legal basis (for example legitimate interest) in the policy for these logs, and if so where and in what words?
4. Is keeping bot and AI rows in full, with no consent step, acceptable given that classification is imperfect and a person can be sorted as a bot?
5. Is the deletion route (contact us with the approximate time and your IP address) adequate, and is it a problem that the IP is the identifier we ask for?
6. Anything else the wording needs before open device recognition is added (not live; see `docs/policy-wording-mpc-7491.md`)?
