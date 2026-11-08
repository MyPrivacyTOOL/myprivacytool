// Meta (Facebook) ads daily collector. READ-ONLY: Marketing API insights for the ad account, previous full Hong Kong day.
// Needs the system-user token META_ADS_KEY (the same token as the Composio Meta Ads connection; it was generated with broader
// permissions than ads_read, so this collector only ever issues GET requests to the insights edge and never calls a write endpoint;
// sent as a Bearer header, never in the URL)
// for the ad account DEFAULT_AD_ACCOUNT_ID ("MyPrivacyTOOL FB Ads", currency GBP, timezone Asia/Hong_Kong; override with the
// non-secret META_AD_ACCOUNT_ID, digits with or without the act_ prefix). Until the token is set the collector stores an ok row
// with payload.configured=false instead of an error, so an unfinished setup raises no alarm.
// The untouched API response is stored in payload.raw; payload.summary is the derived view.
import { previousDay } from './cloudflare-analytics.js';
import { callRecipient } from '../../../shared/recipients/outbound.ts';
import { recipientCtx } from '../lib/recipient-ctx.js';

// UNVERIFIED default: Meta retires Graph versions after about two years; set META_GRAPH_VERSION if this one is rejected.
export const DEFAULT_AD_ACCOUNT_ID = 'act_266295748910383';
export const DEFAULT_GRAPH_VERSION = 'v23.0';
const FIELDS = 'impressions,reach,clicks,spend,ctr,cpc,account_currency';

const num = (v) => (v === undefined || v === null || v === '' ? null : Number(v));
export const accountPath = (id) => `act_${String(id).trim().replace(/^act_/, '')}`;

export default {
  source: 'meta_ads',
  report: 'account_daily',
  async collect(env, now = new Date()) {
    const { start, end, day } = previousDay(now);
    const period = { period_start: start.toISOString(), period_end: end.toISOString() };
    if (!env.META_ADS_KEY) return { ...period, payload: { configured: false, day, missing: ['META_ADS_KEY'] } };
    const account = env.META_AD_ACCOUNT_ID || DEFAULT_AD_ACCOUNT_ID;
    if (!/^(act_)?\d{5,20}$/.test(String(account).trim())) throw new Error('META_AD_ACCOUNT_ID is not a numeric ad account id');
    const version = env.META_GRAPH_VERSION || DEFAULT_GRAPH_VERSION;
    const params = new URLSearchParams({ fields: FIELDS, level: 'account', time_range: JSON.stringify({ since: day, until: day }) });
    const res = await callRecipient('meta-ads-insights', { url: `https://graph.facebook.com/${version}/${accountPath(account)}/insights?${params}`, init: {
      headers: { Authorization: `Bearer ${env.META_ADS_KEY}` },
    }, sent: [] }, recipientCtx(env));
    if (!res.ok) throw new Error(`meta ads insights: HTTP ${res.status}`); // body not echoed: it may repeat request details
    const raw = await res.json();
    const row = raw.data?.[0] ?? null; // no spend that day => Meta returns an empty list
    return {
      ...period,
      payload: {
        configured: true, day, graph_version: version,
        summary: {
          impressions: num(row?.impressions) ?? 0, reach: num(row?.reach) ?? 0, clicks: num(row?.clicks) ?? 0,
          spend: num(row?.spend) ?? 0, ctr: num(row?.ctr), cpc: num(row?.cpc), currency: row?.account_currency ?? null,
        },
        raw,
      },
    };
  },
};
