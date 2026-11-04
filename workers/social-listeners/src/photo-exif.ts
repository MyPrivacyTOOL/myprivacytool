// MPC-7891 measurement A (test-only, PROBE_MODE=on, allow-listed senders): does a profile photo as Telegram serves it carry EXIF / GPS metadata?
// "/photoexif" downloads the sender's own profile photos (largest size, at most MAX_PHOTOS), looks only at the JPEG header segments and replies
// with yes/no counts. Photo bytes are never stored or logged; the download URL (which holds the bot token) is never logged or returned.
import type { Logger } from "./logger";
import { call, telegramSender } from "./probe-reader";
import { baselineSender } from "./baseline-scan";
import type { Env } from "./shared";

const MAX_PHOTOS = 3;
const MAX_BYTES = 5_000_000;
const TIMEOUT_MS = 8000;

export const isPhotoExifRequest = (update: unknown): boolean => {
  const text = (update as { message?: { text?: unknown } } | null)?.message?.text;
  return typeof text === "string" && /^\/photoexif(@\w+)?$/i.test(text.trim());
};

export interface JpegMeta { jpeg: boolean; exif: boolean; gps: boolean; xmp: boolean; iptc: boolean }

/** Reads only the JPEG header segments (up to the start of scan). Pure; never throws. */
export function inspectJpeg(b: Uint8Array): JpegMeta {
  const out: JpegMeta = { jpeg: false, exif: false, gps: false, xmp: false, iptc: false };
  if (b.length < 4 || b[0] !== 0xff || b[1] !== 0xd8) return out;
  out.jpeg = true;
  const ascii = (at: number, s: string) => [...s].every((c, i) => b[at + i] === c.charCodeAt(0));
  let i = 2;
  while (i + 4 <= b.length) {
    if (b[i] !== 0xff) break;
    const marker = b[i + 1];
    if (marker === 0xff) { i++; continue; }
    if (marker === 0xda || marker === 0xd9) break; // start of scan / end of image: no more metadata segments
    if (marker >= 0xd0 && marker <= 0xd7) { i += 2; continue; }
    const len = (b[i + 2] << 8) | b[i + 3];
    const data = i + 4;
    if (len < 2) break;
    if (marker === 0xe1 && ascii(data, "Exif\0\0")) { out.exif = true; if (tiffHasGps(b, data + 6, Math.min(b.length, i + 2 + len))) out.gps = true; }
    else if (marker === 0xe1 && ascii(data, "http://ns.adobe.com/xap")) out.xmp = true;
    else if (marker === 0xed && ascii(data, "Photoshop 3.0")) out.iptc = true;
    i += 2 + len;
  }
  return out;
}

/** True when IFD0 holds the GPS IFD pointer (tag 0x8825) and that GPS IFD lists at least one entry. */
function tiffHasGps(b: Uint8Array, tiff: number, end: number): boolean {
  if (tiff + 8 > end) return false;
  const le = b[tiff] === 0x49 && b[tiff + 1] === 0x49;
  if (!le && !(b[tiff] === 0x4d && b[tiff + 1] === 0x4d)) return false;
  const u16 = (at: number) => (at + 2 > end ? -1 : le ? b[at] | (b[at + 1] << 8) : (b[at] << 8) | b[at + 1]);
  const u32 = (at: number) => (at + 4 > end ? -1 : le ? (b[at] | (b[at + 1] << 8) | (b[at + 2] << 16) | (b[at + 3] << 24)) >>> 0 : ((b[at] << 24) | (b[at + 1] << 16) | (b[at + 2] << 8) | b[at + 3]) >>> 0);
  const ifd0 = tiff + u32(tiff + 4);
  const n = u16(ifd0);
  if (n < 0 || n > 512) return false;
  for (let k = 0; k < n; k++) {
    const e = ifd0 + 2 + k * 12;
    if (u16(e) === 0x8825) {
      const gps = tiff + u32(e + 8);
      const count = u16(gps);
      return count > 0 && count <= 64;
    }
  }
  return false;
}

async function download(env: Env, filePath: string): Promise<Uint8Array | null> {
  try {
    const res = await fetch(`https://api.telegram.org/file/bot${env.TELEGRAM_BOT_TOKEN}/${filePath}`, { signal: AbortSignal.timeout(TIMEOUT_MS) });
    if (!res.ok) return null;
    const buf = new Uint8Array(await res.arrayBuffer());
    return buf.length <= MAX_BYTES ? buf : null;
  } catch {
    return null;
  }
}

const sizeArea = (p: { width?: unknown; height?: unknown; file_size?: unknown }) => (Number(p.width) || 0) * (Number(p.height) || 0) || Number(p.file_size) || 0;

export async function replyPhotoExif(env: Env, update: unknown, log: Logger): Promise<void> {
  try {
    const s = telegramSender(update);
    if (!s || !env.TELEGRAM_BOT_TOKEN) return;
    const reply = (text: string) => call(env, "sendMessage", { chat_id: s.chatId, text });
    if (!baselineSender(env, update)) return void (await reply("Not available for this account."));
    const photos = await call(env, "getUserProfilePhotos", { user_id: Number(s.id), limit: MAX_PHOTOS });
    const sets = (photos.response as { result?: { photos?: unknown } } | null)?.result?.photos;
    if (photos.status !== 200 || !Array.isArray(sets)) return void (await reply("Could not read your profile photos, so nothing was measured."));
    if (sets.length === 0) return void (await reply("No profile photo was returned, so nothing was measured."));
    const results: (JpegMeta | "download_failed")[] = [];
    for (const sizes of sets.slice(0, MAX_PHOTOS)) {
      type Size = { file_id?: unknown; width?: unknown; height?: unknown; file_size?: unknown };
      const best = Array.isArray(sizes) && sizes.length ? (sizes as Size[]).reduce((a, b) => (sizeArea(b) >= sizeArea(a) ? b : a)) : null;
      if (!best || typeof best.file_id !== "string") { results.push("download_failed"); continue; }
      const file = await call(env, "getFile", { file_id: best.file_id });
      const path = (file.response as { result?: { file_path?: unknown } } | null)?.result?.file_path;
      const bytes = typeof path === "string" ? await download(env, path) : null;
      results.push(bytes ? inspectJpeg(bytes) : "download_failed");
    }
    const ok = results.filter((r): r is JpegMeta => r !== "download_failed");
    const count = (f: (m: JpegMeta) => boolean) => `${ok.filter(f).length} of ${ok.length}`;
    const text = ok.length === 0 ? "Could not download your profile photos, so nothing was measured." : [
      `Profile photos checked (largest size, as Telegram serves them): ${ok.length} of ${results.length}`,
      `JPEG files: ${count((m) => m.jpeg)}`,
      `With an EXIF block: ${count((m) => m.exif)}`,
      `With GPS location data: ${count((m) => m.gps)}`,
      `With XMP: ${count((m) => m.xmp)}, with IPTC: ${count((m) => m.iptc)}`,
      "Scope: your own profile photos only, as served to this bot today. Not a statement about every Telegram photo. No image was stored.",
    ].join("\n");
    await reply(text);
    log.info("photo_exif_done", { photos: results.length, measured: ok.length });
  } catch (err) {
    log.warn("photo_exif_failed", { error: err instanceof Error ? err.name : "unknown" });
  }
}
