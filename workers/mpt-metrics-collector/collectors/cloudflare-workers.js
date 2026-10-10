// Daily invocations and errors for the Workers mpt-leads, core-brain and social-listeners, from workersInvocationsAdaptive.
// Payload = untouched API data (one group per script).
import { cfQuery, yesterdayUtc } from './cloudflare-graphql.js';

export const SCRIPTS = ['mpt-leads', 'core-brain', 'social-listeners'];
// Non-secret account id of the MyPrivacyTOOL Cloudflare account (also in wrangler.toml); override with env.CLOUDFLARE_ACCOUNT_ID.
export const DEFAULT_ACCOUNT_ID = '35cb17172c65a20f5cf1baf131485382';

const QUERY = `query ($accountTag: string!, $start: Time!, $end: Time!, $scripts: [string!]) {
  viewer {
    accounts(filter: { accountTag: $accountTag }) {
      workersInvocationsAdaptive(limit: 100, filter: { datetime_geq: $start, datetime_lt: $end, scriptName_in: $scripts }) {
        dimensions { scriptName }
        sum { requests errors }
      }
    }
  }
}`;

export default {
  source: 'cloudflare',
  report: 'workers_daily',
  period: (now) => { const d = yesterdayUtc(now); return { start: d.start, end: d.end }; },
  async collect(env, now = new Date()) {
    const { start, end } = yesterdayUtc(now);
    const data = await cfQuery(env, QUERY, {
      accountTag: env.CLOUDFLARE_ACCOUNT_ID || DEFAULT_ACCOUNT_ID,
      start: start.toISOString(), end: end.toISOString(), scripts: SCRIPTS,
    });
    if (!data.viewer?.accounts?.length) throw new Error('account not found or not readable with this token');
    return { payload: data };
  },
};
