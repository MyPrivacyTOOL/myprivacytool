// YouTube daily collector (MPC-7380). Public channel data via the YouTube Data API v3 with an API key
// (sent as a header, never in the URL, so it cannot leak through error text). Impressions need the YouTube
// Analytics API, which requires OAuth from the channel owner: not collected here (see payload.impressions).
// The untouched API responses are stored in payload.raw; payload.summary is the derived view.
export const DEFAULT_CHANNEL_ID = 'UC-chigimJFz4Rs8ulbDUeFQ';
import { previousDay } from './cloudflare-analytics.js';
const API = 'https://www.googleapis.com/youtube/v3';

async function yt(env, path, params, { allow404 = false } = {}) {
  const res = await fetch(`${API}/${path}?${new URLSearchParams(params)}`, { headers: { 'x-goog-api-key': env.YOUTUBE_API_KEY } });
  if (allow404 && res.status === 404) return { items: [] };
  if (!res.ok) throw new Error(`youtube ${path}: HTTP ${res.status}`);
  return res.json();
}

const num = (v) => (v === undefined || v === null ? null : Number(v));

export default {
  source: 'youtube',
  report: 'channel_daily',
  async collect(env, now = new Date()) {
    if (!env.YOUTUBE_API_KEY) throw new Error('YOUTUBE_API_KEY not set');
    const channelId = env.YOUTUBE_CHANNEL_ID || DEFAULT_CHANNEL_ID;
    // "That day" = the Hong Kong day before this run (the cron fires just after 00:00 HKT).
    const { start: dayStart, end: dayEnd, day } = previousDay(now);

    const channels = await yt(env, 'channels', { part: 'statistics,contentDetails', id: channelId });
    const ch = channels.items?.[0];
    if (!ch) throw new Error(`youtube channel ${channelId} not found`);
    const uploads = ch.contentDetails?.relatedPlaylists?.uploads;

    // Newest 50 uploads; a brand-new channel has none (or no uploads playlist yet).
    const playlistItems = uploads
      ? await yt(env, 'playlistItems', { part: 'contentDetails', playlistId: uploads, maxResults: '50' }, { allow404: true })
      : { items: [] };
    const ids = (playlistItems.items ?? []).map((i) => i.contentDetails?.videoId).filter(Boolean);
    const videos = ids.length
      ? await yt(env, 'videos', { part: 'snippet,statistics', id: ids.join(',') })
      : { items: [] };

    const perVideo = (videos.items ?? []).map((v) => ({
      id: v.id, title: v.snippet?.title ?? null, published_at: v.snippet?.publishedAt ?? null,
      views: num(v.statistics?.viewCount), likes: num(v.statistics?.likeCount), comments: num(v.statistics?.commentCount),
    }));
    const inDay = (v) => v.published_at && new Date(v.published_at) >= dayStart && new Date(v.published_at) < dayEnd;
    const stats = ch.statistics ?? {};
    return {
      period_start: dayStart.toISOString(),
      period_end: dayEnd.toISOString(),
      payload: {
        channel_id: channelId,
        day,
        summary: {
          subscribers: stats.hiddenSubscriberCount ? null : num(stats.subscriberCount),
          subscribers_hidden: Boolean(stats.hiddenSubscriberCount),
          total_views: num(stats.viewCount),
          total_videos: num(stats.videoCount),
          videos_published_on_day: perVideo.filter(inDay).length,
          videos: perVideo,
        },
        impressions: null, // needs YouTube Analytics API + OAuth (youtube.readonly, yt-analytics.readonly); follow-up
        raw: { channels, playlistItems, videos },
      },
    };
  },
};
