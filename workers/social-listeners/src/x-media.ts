// MPC-7628: uploads the Alice "behind the curtain" clip to X so it can ride along on a DM.
// X's console does not offer media.write on the OAuth 2.0 user token (upload answers 403), so the upload is signed with OAuth 1.0a
// (the app's API key + the account's access token and secret), which X accepts on the same endpoint. If those secrets are not set the
// caller's OAuth 2.0 call is tried instead. Every failure returns null: the caller then sends the text alone.
// Chunked v2 flow: INIT -> APPEND (1 MB chunks) -> FINALIZE (-> STATUS while X processes the video).
import type { Logger } from "./logger";
import type { Env } from "./shared";

export const VIDEO_URL = "https://myprivacytool.io/media/alice-curtain.mp4";
const UPLOAD = "/media/upload";
const CHUNK = 1024 * 1024;
const TIMEOUT_MS = 8000;
const POLLS = 5;

const MISSING = (v?: string) => !v || v === "placeholder";
const rfc3986 = (v: string) => encodeURIComponent(v).replace(/[!'()*]/g, (c) => "%" + c.charCodeAt(0).toString(16).toUpperCase());

/** The app's API key (a.k.a. consumer key): X_CONSUMER_KEY, or X_API_KEY (the name already used in the secret inventory). */
const consumerKey = (env: Env): string | undefined => [env.X_CONSUMER_KEY, env.X_API_KEY].find((v) => !MISSING(v));

export const hasOAuth1 = (env: Env): boolean =>
  Boolean(consumerKey(env)) && ![env.X_CONSUMER_SECRET, env.X_ACCESS_TOKEN, env.X_ACCESS_TOKEN_SECRET].some(MISSING);

/** OAuth 1.0a (HMAC-SHA1) Authorization header. Only the oauth_* fields and the query string are signed, not a multipart body. */
export async function oauth1Header(env: Env, method: string, url: string, nonce = crypto.randomUUID().replace(/-/g, ""), ts = String(Math.floor(Date.now() / 1000))): Promise<string> {
  const u = new URL(url);
  const oauth: Record<string, string> = {
    oauth_consumer_key: consumerKey(env)!,
    oauth_nonce: nonce,
    oauth_signature_method: "HMAC-SHA1",
    oauth_timestamp: ts,
    oauth_token: env.X_ACCESS_TOKEN!,
    oauth_version: "1.0",
  };
  const all: [string, string][] = [...Object.entries(oauth), ...u.searchParams.entries()].map(([k, v]) => [rfc3986(k), rfc3986(v)]);
  all.sort((a, b) => (a[0] === b[0] ? (a[1] < b[1] ? -1 : 1) : a[0] < b[0] ? -1 : 1));
  const base = [method.toUpperCase(), rfc3986(`${u.origin}${u.pathname}`), rfc3986(all.map(([k, v]) => `${k}=${v}`).join("&"))].join("&");
  const key = `${rfc3986(env.X_CONSUMER_SECRET!)}&${rfc3986(env.X_ACCESS_TOKEN_SECRET!)}`;
  const k = await crypto.subtle.importKey("raw", new TextEncoder().encode(key), { name: "HMAC", hash: "SHA-1" }, false, ["sign"]);
  const sig = btoa(String.fromCharCode(...new Uint8Array(await crypto.subtle.sign("HMAC", k, new TextEncoder().encode(base)))));
  return "OAuth " + Object.entries({ ...oauth, oauth_signature: sig }).map(([a, b]) => `${rfc3986(a)}="${rfc3986(b)}"`).join(", ");
}

/** The authenticated call the caller already uses for DMs (user token, one refresh on 401). */
export type XUserCall = (path: string, init: RequestInit) => Promise<Response | null>;

const idOf = (b: any): string | null => {
  const id = b?.data?.id ?? b?.media_id_string ?? b?.id;
  return typeof id === "string" || typeof id === "number" ? String(id) : null;
};

async function loadVideo(env: Env): Promise<Uint8Array | null> {
  const res = await fetch(env.MEDIA_VIDEO_URL || VIDEO_URL, { signal: AbortSignal.timeout(TIMEOUT_MS) });
  return res.ok ? new Uint8Array(await res.arrayBuffer()) : null;
}

const fail = (log: Logger, event: string, extra?: Record<string, unknown>): null => {
  log.warn(event, extra);
  return null;
};

/** Uploads the clip and returns its media id, or null when anything goes wrong. */
export async function uploadDmVideo(env: Env, log: Logger, oauth2Call: XUserCall): Promise<string | null> {
  const call: XUserCall = hasOAuth1(env)
    ? async (path, init) => {
        const url = `https://api.x.com/2${path}`;
        try {
          return await fetch(url, { ...init, headers: { Authorization: await oauth1Header(env, init.method ?? "GET", url) }, signal: AbortSignal.timeout(TIMEOUT_MS) });
        } catch {
          return null;
        }
      }
    : oauth2Call;
  if (env.MEDIA_VIDEO_URL === "off") return null; // kill switch (also keeps unrelated tests off the network)
  try {
    const video = await loadVideo(env);
    if (!video?.length) return fail(log, "x_media_video_unavailable");
    const api = (extra: Record<string, string>, body?: FormData) => {
      const form = body ?? new FormData();
      for (const [k, v] of Object.entries(extra)) form.append(k, v);
      return call(UPLOAD, { method: "POST", body: form });
    };

    const init = await api({ command: "INIT", media_type: "video/mp4", total_bytes: String(video.length), media_category: "dm_video" });
    if (!init?.ok) return fail(log, "x_media_init_rejected", { status: init?.status ?? 0 });
    const id = idOf(await init.json());
    if (!id) return fail(log, "x_media_init_malformed");

    for (let i = 0, seg = 0; i < video.length; i += CHUNK, seg++) {
      const form = new FormData();
      form.append("media", new Blob([video.slice(i, i + CHUNK)], { type: "application/octet-stream" }), "chunk");
      const res = await api({ command: "APPEND", media_id: id, segment_index: String(seg) }, form);
      if (!res?.ok) return fail(log, "x_media_append_rejected", { status: res?.status ?? 0 });
    }

    const fin = await api({ command: "FINALIZE", media_id: id });
    if (!fin?.ok) return fail(log, "x_media_finalize_rejected", { status: fin?.status ?? 0 });
    let info = ((await fin.json()) as any)?.data?.processing_info ?? null;
    for (let n = 0; info && n < POLLS; n++) {
      if (info.state === "succeeded") break;
      if (info.state === "failed") return fail(log, "x_media_processing_failed");
      await new Promise((r) => setTimeout(r, Math.min(Math.max(Number(info.check_after_secs) || 1, 1), 3) * 1000));
      const st = await call(`${UPLOAD}?command=STATUS&media_id=${id}`, { method: "GET" });
      info = st?.ok ? (((await st.json()) as any)?.data?.processing_info ?? null) : info;
    }
    if (info && info.state !== "succeeded") return fail(log, "x_media_processing_timeout");
    return id;
  } catch (err) {
    log.warn("x_media_failed", { error: err instanceof Error ? err.name : "unknown" });
    return null;
  }
}
