import guides from './guides.generated.js';

// People-search brokers named in MPC-6677. The report only ever says what we could verify.
//
// Why every broker is "not yet checked": the form collects an email address only. These sites
// search by name/location, their terms prohibit automated scraping, and they sit behind bot
// protection, so there is no reliable, ToS-compliant lookup by email. We therefore do NOT query
// them and do NOT guess. Each broker is reported as "not yet checked" with the official
// opt-out page, so the user can check and remove themselves.
// To turn a broker into a real check later, add an entry to CHECKERS (a function returning
// 'found' | 'clear' | 'not_checked'), e.g. backed by a licensed API.
export const BROKERS = [
  { key: 'spokeo',       name: 'Spokeo',       guide: 'spokeo' },
  { key: 'whitepages',   name: 'Whitepages',   guide: 'whitepages' },
  { key: 'beenverified', name: 'BeenVerified', guide: 'beenverified' },
  { key: 'mylife',       name: 'MyLife',       guide: 'mylife' },        // MPC-9813: guide written
  { key: 'intelius',     name: 'Intelius',     guide: 'intelius' },      // MPC-9813: guide written
];

// MPC-9813: the nine shortlist brokers of docs/broker-lookup-contract-mpc-9812.md, with the domains used to recognise a page the visitor pastes.
// A page on any other site is still read (the visitor chose it); it just is not tied to a shortlist broker. `fetchable: false` = no lawful read
// (Truecaller needs a sign-in): a pasted address is reported not_checked, with its guide.
export const BROKER_SITES = [
  { key: 'spokeo',           name: 'Spokeo',                   guide: 'spokeo',                       domains: ['spokeo.com'] },
  { key: 'whitepages',       name: 'Whitepages',               guide: 'whitepages',                   domains: ['whitepages.com'] },
  { key: 'beenverified',     name: 'BeenVerified',             guide: 'beenverified',                 domains: ['beenverified.com'] },
  { key: 'truthfinder',      name: 'TruthFinder',              guide: 'truthfinder',                  domains: ['truthfinder.com'] },
  { key: 'fastpeoplesearch', name: 'FastPeopleSearch',         guide: 'fastpeoplesearch',             domains: ['fastpeoplesearch.com'] },
  { key: 'mylife',           name: 'MyLife',                   guide: 'mylife',                       domains: ['mylife.com'] },
  { key: 'intelius',         name: 'Intelius',                 guide: 'intelius',                     domains: ['intelius.com'] },
  { key: 'whitepages_au',    name: 'White Pages Australia',    guide: 'australia-white-pages-listing', domains: ['whitepages.com.au'] },
  { key: 'truecaller',       name: 'Truecaller',               guide: 'truecaller-unlist-number',     domains: ['truecaller.com'], fetchable: false },
];

// The opt-out guide for a registry slug, in the same short shape the report uses; null when there is none.
export function guideFor(slug) {
  const g = slug ? guides.find((x) => x.slug === slug) : null;
  return g ? { slug: g.slug, name: g.name, optOutUrl: g.optOutUrl ?? null, timeNeeded: g.timeNeeded ?? null, processingTime: g.processingTime ?? null, steps: g.steps?.slice(0, 4) ?? null } : null;
}

export const CHECKERS = {}; // none are reliable + permitted today

export async function checkBrokers(_email, _env) {
  return BROKERS.map((b) => {
    const g = b.guide ? guides.find((x) => x.slug === b.guide) : null;
    const checker = CHECKERS[b.key];
    return {
      key: b.key,
      name: b.name,
      status: checker ? 'checker-available' : 'not_checked',
      reason: 'Needs your name and location to search, and automated lookups are not permitted by the site',
      removal_url: g?.optOutUrl ?? null,                          // only links we have verified in optOutGuides.json
      time_needed: g?.timeNeeded ?? null,
      processing_time: g?.processingTime ?? null,
      steps: g?.steps?.slice(0, 4) ?? null,                       // short, verified steps; null = guide not written yet
    };
  });
}
