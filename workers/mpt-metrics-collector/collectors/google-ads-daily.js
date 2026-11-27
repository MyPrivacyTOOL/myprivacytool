// Google Ads daily collector (MPC-9972, Strategy Stage D). READ-ONLY: reuses the proven client in google-ads.js (accessToken + searchStream,
// i.e. GoogleAdsService:searchStream only, never a mutate endpoint) and adds no new OAuth path or secret.
// One row per run: the previous full day, aggregates only (MPC-8659): per-campaign totals and per-conversion-action totals, never a click, a user or a search term.
// Empty result (no campaigns yet) => an ok row with zeros. Secrets missing => an ok row with payload.configured=false and no network call.
// Calls per run: 1 token + 2 searchStream queries = 3 (the conversion_action segment cannot share a query with impressions/cost).
// segments.date is in the Google Ads ACCOUNT's time zone, and the MPT account (627-131-2111) is on UK time (GMT+00:00, Strategy §4, irreversible), not Hong Kong.
// So the row covers the previous full UTC/UK calendar day (the account's day), labelled by that date; period_start/period_end are that day's real instants.
const DAY_MS = 86400000;
const previousAccountDay = (now) => { const end = new Date(Math.floor(now.getTime() / DAY_MS) * DAY_MS); const start = new Date(end.getTime() - DAY_MS); return { start, end, day: start.toISOString().slice(0, 10) }; };
import { accessToken, searchStream, missing } from './google-ads.js';

const num = (v) => (v === undefined || v === null || v === '' || !Number.isFinite(Number(v)) ? 0 : Number(v));
const money = (micros) => Math.round(num(micros)) / 1e6; // cost_micros arrives as a string of an int64

export const campaignQuery = (day) => `SELECT campaign.name, campaign.status, metrics.impressions, metrics.clicks, metrics.cost_micros, metrics.conversions, metrics.conversions_value FROM campaign WHERE segments.date = '${day}'`;
export const conversionActionQuery = (day) => `SELECT customer.currency_code, segments.conversion_action_name, metrics.conversions, metrics.conversions_value FROM customer WHERE segments.date = '${day}'`;

export const SCAN_STARTED = /^scan[_\s-]?started$/i;
export const PAID_CONVERSION = /^(purchase|paid|subscription|subscribe|checkout[_\s-]?completed)/i; // CAC denominator: paid conversions only

export default {
  source: 'google-ads',
  report: 'account_daily',
  async collect(env, now = new Date()) {
    const { start, end, day } = previousAccountDay(now);
    const period = { period_start: start.toISOString(), period_end: end.toISOString() };
    const miss = missing(env);
    if (miss.length) return { ...period, payload: { configured: false, day, missing: miss } };
    const token = await accessToken(env);
    const campaignRows = await searchStream(env, campaignQuery(day), token);
    const actionRows = await searchStream(env, conversionActionQuery(day), token);

    const campaigns = campaignRows.map((r) => ({
      name: r.campaign?.name ?? null, status: r.campaign?.status ?? null,
      impressions: num(r.metrics?.impressions), clicks: num(r.metrics?.clicks), cost: money(r.metrics?.costMicros),
      conversions: num(r.metrics?.conversions), conversions_value: num(r.metrics?.conversionsValue),
    }));
    const sum = (k) => campaigns.reduce((s, c) => s + c[k], 0);
    const byAction = new Map();
    for (const r of actionRows) {
      const name = r.segments?.conversionActionName ?? '(unnamed)';
      const a = byAction.get(name) ?? { name, conversions: 0, conversions_value: 0 };
      a.conversions += num(r.metrics?.conversions); a.conversions_value += num(r.metrics?.conversionsValue);
      byAction.set(name, a);
    }
    const conversion_actions = [...byAction.values()];
    const currency = actionRows.find((r) => r.customer?.currencyCode)?.customer.currencyCode ?? null;
    return {
      ...period,
      payload: {
        configured: true, day, account_time_zone: 'GMT+00:00', currency,
        summary: {
          campaigns: campaigns.length, impressions: sum('impressions'), clicks: sum('clicks'), cost: Math.round(sum('cost') * 1e6) / 1e6,
          conversions: sum('conversions'), conversions_value: sum('conversions_value'),
          scan_started: conversion_actions.filter((a) => SCAN_STARTED.test(a.name)).reduce((s, a) => s + a.conversions, 0),
          paid_conversions: conversion_actions.filter((a) => PAID_CONVERSION.test(a.name)).reduce((s, a) => s + a.conversions, 0),
        },
        campaigns, conversion_actions,
      },
    };
  },
};
