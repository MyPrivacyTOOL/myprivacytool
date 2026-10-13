// MPC-7628: uploads the Alice "behind the curtain" clip to X so it can ride along on a DM.
// Needs the media.write scope on the user token. Every failure returns null: the caller then sends the text alone.
// Chunked v2 flow: INIT -> APPEND (1 MB chunks) -> FINALIZE (-> STATUS while X processes the video).
import type { Logger } from "./logger";
import type { Env } from "./shared";

export const VIDEO_URL = "https://myprivacytool.io/media/alice-curtain.mp4";
const UPLOAD = "/media/upload";
const CHUNK = 1024 * 1024;
const TIMEOUT_MS = 8000;
const POLLS = 5;

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
export async function uploadDmVideo(env: Env, log: Logger, call: XUserCall): Promise<string | null> {
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
