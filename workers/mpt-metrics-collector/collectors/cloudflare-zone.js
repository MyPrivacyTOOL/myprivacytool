// Daily requests and unique visitors for the site zone (myprivacytool.io), from httpRequests1dGroups.
// Cross-check on GA4, which undercounts because of consent banners and ad blockers. Payload = untouched API data.
import { cfQuery, yesterdayUtc } from './cloudflare-graphql.js';

const QUERY = `query ($zoneTag: string!, $date: Date!) {
  viewer {
    zones(filter: { zoneTag: $zoneTag }) {
      httpRequests1dGroups(limit: 1, filter: { date: $date }) {
        dimensions { date }
        sum { requests }
        uniq { uniques }
      }
    }
  }
}`;

export default {
  source: 'cloudflare',
  report: 'zone_daily',
  period: (now) => { const d = yesterdayUtc(now); return { start: d.start, end: d.end }; },
  async collect(env, now = new Date()) {
    if (!env.CLOUDFLARE_ZONE_ID) throw new Error('CLOUDFLARE_ZONE_ID not set');
    const data = await cfQuery(env, QUERY, { zoneTag: env.CLOUDFLARE_ZONE_ID, date: yesterdayUtc(now).date });
    if (!data.viewer?.zones?.length) throw new Error('zone not found or not readable with this token');
    return { payload: data };
  },
};
