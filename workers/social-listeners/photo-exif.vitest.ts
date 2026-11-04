// @vitest-environment node
/* eslint-disable @typescript-eslint/no-explicit-any */
import { afterEach, describe, expect, it, vi } from "vitest";
import worker from "./src/index";
import { inspectJpeg } from "./src/photo-exif";
import type { Env } from "./src/shared";

const TOKEN = "123:SECRET-BOT-TOKEN";
const ID = 6000000001; // synthetic
const seg = (marker: number, data: number[]) => [0xff, marker, (data.length + 2) >> 8, (data.length + 2) & 255, ...data];
const ascii = (s: string) => [...s].map((c) => c.charCodeAt(0));
// Big-endian TIFF: IFD0 with one entry (GPS IFD pointer 0x8825) -> GPS IFD with one entry.
const tiffGps = [0x4d, 0x4d, 0, 42, 0, 0, 0, 8, 0, 1, 0x88, 0x25, 0, 4, 0, 0, 0, 1, 0, 0, 0, 26, 0, 0, 0, 0, 0, 1, 0, 1, 0, 2, 0, 0, 0, 2, 0x4e, 0, 0, 0, 0, 0, 0, 0];
const tiffNoGps = [0x4d, 0x4d, 0, 42, 0, 0, 0, 8, 0, 1, 0x01, 0x0f, 0, 2, 0, 0, 0, 2, 0x41, 0, 0, 0, 0, 0, 0, 0];
const jpeg = (...segs: number[][]) => new Uint8Array([0xff, 0xd8, ...segs.flat(), ...seg(0xda, [0, 0, 0]), 1, 2, 3, 0xff, 0xd9]);

describe("inspectJpeg", () => {
  it("clean JPEG: no metadata", () => expect(inspectJpeg(jpeg(seg(0xe0, ascii("JFIF\0"))))).toEqual({ jpeg: true, exif: false, gps: false, xmp: false, iptc: false }));
  it("EXIF without GPS", () => expect(inspectJpeg(jpeg(seg(0xe1, [...ascii("Exif\0\0"), ...tiffNoGps])))).toMatchObject({ exif: true, gps: false }));
  it("EXIF with GPS IFD", () => expect(inspectJpeg(jpeg(seg(0xe1, [...ascii("Exif\0\0"), ...tiffGps])))).toMatchObject({ exif: true, gps: true }));
  it("XMP and IPTC are reported separately", () => {
    expect(inspectJpeg(jpeg(seg(0xe1, ascii("http://ns.adobe.com/xap/1.0/\0x"))))).toMatchObject({ xmp: true, exif: false });
    expect(inspectJpeg(jpeg(seg(0xed, ascii("Photoshop 3.0\0"))))).toMatchObject({ iptc: true });
  });
  it("not a JPEG, truncated or hostile input never throws", () => {
    expect(inspectJpeg(new Uint8Array([1, 2, 3, 4, 5])).jpeg).toBe(false);
    expect(inspectJpeg(new Uint8Array([0xff, 0xd8, 0xff, 0xe1, 0xff, 0xff, 0x45])).gps).toBe(false);
    expect(inspectJpeg(new Uint8Array(0)).jpeg).toBe(false);
  });
});

function setup(envOver: Record<string, unknown> = {}, bytes: Uint8Array | null = jpeg(seg(0xe0, ascii("JFIF\0")))) {
  const calls: { url: string; body: any }[] = [];
  const logs: string[] = [];
  for (const m of ["log", "warn", "error"] as const) vi.spyOn(console, m).mockImplementation((x) => { logs.push(String(x)); });
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    calls.push({ url, body: init?.body ? JSON.parse(String(init.body)) : undefined });
    if (url.includes("/file/bot")) return bytes ? new Response(bytes) : new Response("no", { status: 404 });
    if (url.includes("/getUserProfilePhotos")) return Response.json({ ok: true, result: { photos: [[{ file_id: "SECRET-F1", width: 160, height: 160 }, { file_id: "SECRET-F2", width: 640, height: 640 }]] } });
    if (url.includes("/getFile")) return Response.json({ ok: true, result: { file_path: "photos/file_1.jpg" } });
    return Response.json({ ok: true });
  }));
  const brain = vi.fn(async () => Response.json({ ignored: true }));
  const env = { TELEGRAM_WEBHOOK_SECRET: "s", TELEGRAM_BOT_TOKEN: TOKEN, PROBE_MODE: "on", PROBE_TELEGRAM_IDS: String(ID), CORE_BRAIN: { fetch: brain }, ...envOver } as unknown as Env;
  const post = (text: string, id = ID) => worker.fetch(new Request("https://x/webhook/telegram", { method: "POST", headers: { "X-Telegram-Bot-Api-Secret-Token": "s" },
    body: JSON.stringify({ update_id: 1, message: { message_id: 1, date: 1, text, from: { id, is_bot: false, first_name: "T" }, chat: { id, type: "private" } } }) }), env);
  return { calls, logs, post, brain, sent: () => calls.filter((c) => c.url.includes("/sendMessage")) };
}
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe("/photoexif", () => {
  it("downloads the largest size of the sender's own photo and replies with counts only", async () => {
    const t = setup();
    await t.post("/photoexif");
    expect(t.calls.find((c) => c.url.includes("/getFile"))!.body.file_id).toBe("SECRET-F2");
    const text = t.sent()[0].body.text as string;
    expect(text).toMatch(/With an EXIF block: 0 of 1/);
    expect(text).toMatch(/With GPS location data: 0 of 1/);
    expect(text).not.toMatch(/SECRET|file_|bot123/);
    expect(t.logs.join("\n")).not.toMatch(/SECRET/);
    expect(t.brain).not.toHaveBeenCalled();
  });
  it("reports GPS when the downloaded photo has it", async () => {
    const t = setup({}, jpeg(seg(0xe1, [...ascii("Exif\0\0"), ...tiffGps])));
    await t.post("/photoexif");
    expect(t.sent()[0].body.text).toMatch(/EXIF block: 1 of 1[\s\S]*GPS location data: 1 of 1/);
  });
  it("a failed download is not a clean result", async () => {
    const t = setup({}, null);
    await t.post("/photoexif");
    expect(t.sent()[0].body.text).toMatch(/Could not download/);
  });
  it("is off unless PROBE_MODE=on, and refuses a sender who is not allow-listed", async () => {
    const off = setup({ PROBE_MODE: undefined });
    await off.post("/photoexif");
    expect(off.calls.some((c) => c.url.includes("/getFile"))).toBe(false);
    const other = setup();
    await other.post("/photoexif", 777);
    expect(other.calls.some((c) => c.url.includes("/getFile"))).toBe(false);
    expect(other.sent()[0].body.text).toMatch(/Not available/);
  });
});
