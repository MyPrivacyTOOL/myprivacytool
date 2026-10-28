// MPC-8689 pilot: YouTube extras. An operator (not the commenter) asks for the check on a comment left on one of our videos: POST /youtube/check with the comment resource and the
// header X-Extras-Secret. 6 hexagons, field names confirmed against developers.google.com/youtube/v3/docs: the comment (authorDisplayName, authorProfileImageUrl, authorChannelId,
// textDisplay, publishedAt, likeCount, imageUrl) and five public channel lookups of the author (channels.list: snippet.publishedAt, snippet.country, snippet.customUrl and description,
// brandingSettings keywords, statistics, topicDetails.topicCategories). The comments.list `id` filter is documented as working only for Google+ comments, so this takes the comment resource
// as input (from commentThreads.list, run by the operator) and only calls channels.list. Whether an API key alone is enough for channels.list is not stated in the docs; a non-200 answer is
// "not checked". Off unless YOUTUBE_EXTRAS=on; only allow-listed channel ids (YOUTUBE_PROBE_CHANNEL_IDS). Nothing stored, nothing posted to YouTube; the answer carries states and counts, no values.
// Not built: liked videos playlist (Verify).
import { createLogger } from "./logger";
import { type Env, readRawBody, timingSafeEqual } from "./shared";
import { allowedId, filled, obj, toStates, type ExtraDef, type ExtraState, type Obj } from "./extras-common";

const log = createLogger("social-listeners:youtube");
export const YOUTUBE_EXTRA_HEXAGONS: readonly ExtraDef[] = [
  { id: "yt.comment", label: "Comment on our video", arrival: "A", source: "comments snippet" },
  { id: "yt.channel_age", label: "Channel age", arrival: "B", source: "channels snippet.publishedAt" },
  { id: "yt.country", label: "Channel country", arrival: "B", source: "snippet.country" },
  { id: "yt.channel_about", label: "Channel description and handle", arrival: "B", source: "snippet, brandingSettings.channel.keywords" },
  { id: "yt.stats", label: "Audience size", arrival: "B", source: "statistics" },
  { id: "yt.topics", label: "Topics", arrival: "B", source: "topicDetails.topicCategories" },
];

export const commentAuthorChannelId = (comment: unknown): string | null => {
  const v = obj(obj(obj(comment)?.snippet)?.authorChannelId)?.value;
  return typeof v === "string" && /^UC[A-Za-z0-9_-]{22}$/.test(v) ? v : null;
};

export function youtubeStates(comment: unknown, channel: Obj | null): ExtraState[] {
  const s = obj(obj(comment)?.snippet) ?? {};
  const sn = obj(channel?.snippet) ?? {}, st = obj(channel?.statistics) ?? {}, br = obj(obj(channel?.brandingSettings)?.channel) ?? {}, tp = obj(channel?.topicDetails) ?? {};
  const returned: Record<string, boolean> = { "yt.comment": ["authorDisplayName", "authorProfileImageUrl", "textDisplay", "publishedAt"].some((k) => filled(s[k])) || filled(obj(s.authorChannelId)?.value) };
  const skipped: string[] = [];
  if (channel) Object.assign(returned, {
    "yt.channel_age": filled(sn.publishedAt), "yt.country": filled(sn.country), "yt.channel_about": filled(sn.description) || filled(sn.customUrl) || filled(br.keywords),
    "yt.stats": filled(st.subscriberCount) || typeof st.hiddenSubscriberCount === "boolean" || filled(st.videoCount) || filled(st.viewCount), "yt.topics": filled(tp.topicCategories),
  }); else skipped.push("yt.channel_age", "yt.country", "yt.channel_about", "yt.stats", "yt.topics");
  return toStates(YOUTUBE_EXTRA_HEXAGONS, returned, skipped);
}

export async function lookupChannel(channelId: string, apiKey: string | undefined, fetchImpl: typeof fetch = fetch): Promise<Obj | null> {
  if (!apiKey) return null;
  try {
    const url = `https://www.googleapis.com/youtube/v3/channels?part=snippet,statistics,topicDetails,brandingSettings&id=${encodeURIComponent(channelId)}&key=${encodeURIComponent(apiKey)}`;
    const r = await fetchImpl(url, { signal: AbortSignal.timeout(5000) });
    if (!r.ok) return null;
    const items = obj(await r.json())?.items;
    return Array.isArray(items) ? obj(items[0]) : null;
  } catch { return null; }
}

export async function handleYoutubeExtras(request: Request, env: Env, fetchImpl: typeof fetch = fetch): Promise<Response> {
  if (request.method !== "POST") return new Response("Method Not Allowed", { status: 405 });
  if (env.YOUTUBE_EXTRAS !== "on") return new Response("Not Found", { status: 404 });
  if (!env.YOUTUBE_EXTRAS_SECRET || !timingSafeEqual(request.headers.get("X-Extras-Secret"), env.YOUTUBE_EXTRAS_SECRET)) { log.warn("secret_invalid"); return new Response("Unauthorized", { status: 401 }); }
  const raw = await readRawBody(request);
  if (raw === null) return new Response("Payload Too Large", { status: 413 });
  let body: Obj | null;
  try { body = obj(JSON.parse(raw)); } catch { body = null; }
  const comment = obj(body?.comment);
  if (!comment) return new Response("Bad Request", { status: 400 });
  const channelId = commentAuthorChannelId(comment);
  if (!channelId || !allowedId(env.YOUTUBE_PROBE_CHANNEL_IDS, channelId)) { log.info("not_allowed"); return Response.json({ ok: true, checked: false }); }
  const channel = await lookupChannel(channelId, env.YOUTUBE_API_KEY, fetchImpl);
  const states = youtubeStates(comment, channel);
  const seen = states.filter((s) => s.state === "returned").length;
  log.info("checked", { seen }); // counts only
  return Response.json({ ok: true, checked: true, seen, total: states.filter((s) => s.state !== "not_checked").length, states: states.map((s) => ({ id: s.id, state: s.state })) });
}
