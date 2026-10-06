// MPC-7033: generates the 13-week content calendar (39 blog, 91 X, 26 Reddit).
// Usage: node scripts/generate-content-calendar.mjs > docs/content-calendar-mpc-7033.csv
// MPC-7504: `--linkedin` instead prints the LinkedIn schedule (one Thursday post per week, week 1 = pillar post):
//   node scripts/generate-content-calendar.mjs --linkedin > docs/linkedin-schedule-mpc-7504.csv
const SITE = 'https://www.myprivacytool.io';
const START = new Date(Date.UTC(2026, 9, 7)); // Wed 2026-10-07
const WEEKS = 13;

const blog = [
  ['what-is-a-data-broker', 'What Is a Data Broker? (And How to Find Out Who Has Your Data)'],
  ['digital-privacy-checklist', 'The Digital Privacy Checklist: 15 Fixes in One Afternoon'],
  ['protect-privacy-online', 'How to Protect Your Privacy Online in 2026'],
  ['opt-out-spokeo', 'How to Opt Out of Spokeo (Step by Step)'],
  ['opt-out-whitepages', 'How to Remove Yourself From WhitePages'],
  ['hk-sg-data-broker-removal', 'Data Broker Removal in Hong Kong and Singapore'],
  ['remove-number-truecaller', 'How to Remove Your Number From Truecaller'],
  ['what-is-your-exposure-score', 'What Is a Privacy Exposure Score and Why Does It Matter?'],
  ['employee-privacy-risk', 'Why Employee Data Exposure Is a Company Security Risk'],
];
const x = [
  'One thing data brokers know about you that you never gave them',
  'Thread: how a people-search site builds a profile of you in 4 steps',
  'The 5-minute fix: remove yourself from one broker today',
  'Why your LinkedIn profile feeds B2B data brokers',
  'Do Not Call registries: what they do and do not stop',
  'How to check whether your data is on brokers (free)',
  'AI training on your data: the opt-outs that actually exist',
];
const reddit = [
  ['r/privacy', 'Answer an open question on removing data from people-search sites'],
  ['r/cybersecurity', 'Contribute to a thread on employee data exposure and phishing'],
];

const pad = (n) => String(n).padStart(2, '0');
const iso = (d) => `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
const utm = (path, source, campaign) =>
  `${SITE}${path}?utm_source=${source}&utm_medium=${source === 'blog' ? 'owned' : 'social'}&utm_campaign=${campaign}`;
const q = (s) => `"${String(s).replace(/"/g, '""')}"`;

const rows = [['date', 'week', 'content_type', 'title', 'target', 'url_with_utm', 'status']];
let bi = 0;
for (let w = 0; w < WEEKS; w++) {
  const wk = w + 1;
  const day = (o) => { const d = new Date(START); d.setUTCDate(d.getUTCDate() + w * 7 + o); return iso(d); };
  const campaign = `mpc-7033-w${pad(wk)}`;
  // Blog: Thu, Sat, Tue (Wed-based week offsets 1, 3, 6)
  for (const o of [1, 3, 6]) {
    const [slug, title] = blog[bi++ % blog.length];
    const n = Math.floor((bi - 1) / blog.length);
    const t = n ? `${title} (refresh ${n + 1})` : title;
    rows.push([day(o), wk, 'blog', t, 'myprivacytool.io/blog', utm(`/blog/${slug}`, 'blog', campaign), 'draft']);
  }
  for (let o = 0; o < 7; o++) {
    rows.push([day(o), wk, 'x', x[(w + o) % x.length], 'x.com', utm('/scan', 'x', campaign), 'draft']);
  }
  [[2, 0], [5, 1]].forEach(([o, r]) => {
    rows.push([day(o), wk, 'reddit', reddit[r][1], reddit[r][0], utm('/scan', 'reddit', campaign), 'draft']);
  });
}
// Week 1 anchors on the pillar post
rows[1][3] = 'How Exposed Are You? The 46 Things Tracking You Online (pillar)';
rows[1][5] = utm('/blog/how-exposed-are-you', 'blog', 'mpc-7033-w01');
if (process.argv.includes('--linkedin')) {
  const li = [['date', 'week', 'content_type', 'title', 'target', 'url_with_utm', 'status', 'owner', 'posted_url']];
  // Thursday blog row of each week (offset 1 is the first blog row of the week)
  rows.filter((r) => r[2] === 'blog' && new Date(r[0] + 'T00:00:00Z').getUTCDay() === 4).forEach((r) => {
    const wk = Number(r[1]);
    const path = new URL(r[5]).pathname;
    li.push([r[0], wk, wk === 1 ? 'linkedin-pillar' : 'linkedin-weekly', r[3], 'linkedin.com/company/myprivacytool',
      utm(path, 'linkedin', `mpc-7504-w${pad(wk)}`), 'draft', '', '']);
  });
  console.log(li.map((r) => r.map(q).join(',')).join('\n'));
} else
console.log(rows.map((r) => r.map(q).join(',')).join('\n'));
