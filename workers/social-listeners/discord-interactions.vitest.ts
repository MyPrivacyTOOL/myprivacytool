// @vitest-environment node
/* eslint-disable @typescript-eslint/no-explicit-any */
// MPC-8689 pilot: the Discord interactions endpoint. Locally generated Ed25519 keys and synthetic interactions only; nothing here reaches Discord.
import { afterEach, describe, expect, it, vi } from "vitest";
import { DISCORD_EXTRA_HEXAGONS, accountCreated, bannerState, discordReply, discordStates, handleDiscordInteraction, verifyDiscordSignature } from "./src/discord-interactions";
import { DISCORD_EXTRA_IDS } from "../../shared/hexagon-registry/channels.js";
import { HEXAGON_CATALOGUE } from "../../shared/hexagon-registry/catalogue.js";
import type { Env } from "./src/shared";

const hex = (b: ArrayBuffer) => [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, "0")).join("");
const keys = (await crypto.subtle.generateKey({ name: "Ed25519" }, true, ["sign", "verify"])) as CryptoKeyPair;
const PUB = hex(await crypto.subtle.exportKey("raw", keys.publicKey));
const sign = async (ts: string, body: string) => hex(await crypto.subtle.sign({ name: "Ed25519" }, keys.privateKey, new TextEncoder().encode(ts + body)));
const ID = "80351110224678912"; // a snowflake from Discord's own docs; created in 2015
const env = (over: Record<string, unknown> = {}) => ({ DISCORD_SCAN: "on", DISCORD_PUBLIC_KEY: PUB, DISCORD_PROBE_IDS: ID, ...over }) as unknown as Env;
const guildCmd = (over: Record<string, unknown> = {}) => ({
  type: 2, id: "1", locale: "en-GB", guild_id: "222222222222222222", channel_id: "333333333333333333", context: 0,
  member: { user: { id: ID, username: "nelly", global_name: "Nelly", avatar: "abc", public_flags: 64, primary_guild: { identity_guild_id: "9" } } },
  data: { name: "scan", options: [{ name: "x", value: "y" }] }, entitlements: [{ id: "5" }], ...over,
});
async function post(body: unknown, e: Env, headers: Record<string, string> = {}, fetchImpl?: typeof fetch) {
  const raw = typeof body === "string" ? body : JSON.stringify(body);
  const ts = "1700000000";
  return handleDiscordInteraction(new Request("https://x/webhook/discord", { method: "POST", body: raw, headers: { "X-Signature-Ed25519": await sign(ts, raw), "X-Signature-Timestamp": ts, ...headers } }), e, fetchImpl);
}
afterEach(() => { vi.restoreAllMocks(); });

describe("discord extras", () => {
  it("are 11, in the catalogue as Discord items marked OK and still 'new', and the sign-in ones are not built", () => {
    expect(DISCORD_EXTRA_HEXAGONS).toHaveLength(11);
    expect(DISCORD_EXTRA_HEXAGONS.map((x) => x.id)).toEqual(DISCORD_EXTRA_IDS);
    for (const id of DISCORD_EXTRA_IDS) expect(HEXAGON_CATALOGUE.find((h) => h.id === id && h.channel === "discord" && h.status === "new" && h.access === "OK")).toBeTruthy();
    for (const id of ["dc.email", "dc.connections", "dc.servers", "dc.nitro_mfa"]) expect(DISCORD_EXTRA_IDS).not.toContain(id);
  });
  it("read the person from member.user in a server and from user in a DM; 'returned' only when the field is really there", () => {
    const s = (i: unknown) => Object.fromEntries(discordStates(i).map((x) => [x.id, x.state]));
    const guild = s(guildCmd());
    expect(guild).toMatchObject({ "dc.user_id": "returned", "dc.names": "returned", "dc.avatar": "returned", "dc.server_tag": "returned", "dc.badges": "returned", "dc.language": "returned", "dc.context": "returned", "dc.member": "returned", "dc.purchases": "returned", "dc.command_input": "returned", "dc.banner": "not_checked" });
    const dm = s({ type: 2, locale: "fr", user: { id: ID, username: "nelly", public_flags: 0 }, data: { name: "scan" } });
    expect(dm).toMatchObject({ "dc.user_id": "returned", "dc.names": "returned", "dc.avatar": "not_returned", "dc.badges": "not_returned", "dc.member": "not_returned", "dc.purchases": "not_returned", "dc.command_input": "not_returned", "dc.language": "returned" });
    for (const v of Object.values(s({}))) expect(v).not.toBe("returned");
  });
  it("derive the account creation date from the id, and reject anything that is not an id", () => {
    expect(accountCreated(ID)?.getUTCFullYear()).toBe(2015);
    for (const bad of ["12", "abc", "", undefined, 5, "999999999999999999999"]) expect(accountCreated(bad)).toBeNull();
  });
  it("reply lists only what was seen as seen, says it is extra and stored nothing, and never contains the user id", () => {
    const i = guildCmd();
    const text = discordReply(discordStates(i), i);
    expect(text).toContain("Seen:");
    expect(text).toContain("created in");
    expect(text).toContain("not part of any score");
    expect(text).toContain("Nothing was stored");
    expect(text).not.toContain(ID);
    expect(text).not.toContain("nelly");
  });
  it("banner: found only when the lookup returns one; any failure is not_checked (never a guess)", async () => {
    const f = (body: unknown, status = 200) => (async () => new Response(JSON.stringify(body), { status })) as unknown as typeof fetch;
    expect(await bannerState(ID, undefined)).toBe("not_checked");
    expect(await bannerState("bad", "t")).toBe("not_checked");
    expect(await bannerState(ID, "t", f({ banner: "hash" }))).toBe("returned");
    expect(await bannerState(ID, "t", f({ accent_color: 123 }))).toBe("returned");
    expect(await bannerState(ID, "t", f({ banner: null, accent_color: null }))).toBe("not_returned");
    expect(await bannerState(ID, "t", f({}, 403))).toBe("not_checked");
    expect(await bannerState(ID, "t", (async () => { throw new Error("down"); }) as unknown as typeof fetch)).toBe("not_checked");
  });
});

describe("signature", () => {
  it("accepts only a valid Ed25519 signature over timestamp + raw body, and fails closed on anything malformed", async () => {
    const sig = await sign("1", "{}");
    expect(await verifyDiscordSignature(PUB, sig, "1", "{}")).toBe(true);
    expect(await verifyDiscordSignature(PUB, sig, "2", "{}")).toBe(false);
    expect(await verifyDiscordSignature(PUB, sig, "1", "{ }")).toBe(false);
    expect(await verifyDiscordSignature(undefined, sig, "1", "{}")).toBe(false);
    expect(await verifyDiscordSignature(PUB, null, "1", "{}")).toBe(false);
    expect(await verifyDiscordSignature(PUB, "zz", "1", "{}")).toBe(false);
    expect(await verifyDiscordSignature("00".repeat(32), sig, "1", "{}")).toBe(false);
  });
});

describe("endpoint", () => {
  it("is off by default (404) and POST only", async () => {
    expect((await post(guildCmd(), env({ DISCORD_SCAN: undefined }))).status).toBe(404);
    expect((await handleDiscordInteraction(new Request("https://x/webhook/discord"), env())).status).toBe(405);
  });
  it("answers 401 to a bad or missing signature, including a body changed after signing", async () => {
    expect((await post(guildCmd(), env(), { "X-Signature-Ed25519": "00".repeat(64) })).status).toBe(401);
    const raw = JSON.stringify(guildCmd());
    const res = await handleDiscordInteraction(new Request("https://x/webhook/discord", { method: "POST", body: raw + " ", headers: { "X-Signature-Ed25519": await sign("1", raw), "X-Signature-Timestamp": "1" } }), env());
    expect(res.status).toBe(401);
    expect((await handleDiscordInteraction(new Request("https://x/webhook/discord", { method: "POST", body: raw }), env())).status).toBe(401);
  });
  it("answers a PING with a PONG, even for someone who is not allow-listed", async () => {
    const res = await post({ type: 1 }, env({ DISCORD_PROBE_IDS: "" }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ type: 1 });
  });
  it("replies privately (ephemeral, no mentions) to an allow-listed user with what was seen", async () => {
    const res = await post(guildCmd(), env());
    const body: any = await res.json();
    expect(body.type).toBe(4);
    expect(body.data.flags).toBe(64);
    expect(body.data.allowed_mentions).toEqual({ parse: [] });
    expect(body.data.content).toContain("Seen:");
    expect(body.data.content).toContain("Not checked: Banner and colour");
  });
  it("shows nothing to someone who is not allow-listed, and an empty allow-list means nobody", async () => {
    for (const e of [env({ DISCORD_PROBE_IDS: "999" }), env({ DISCORD_PROBE_IDS: undefined })]) {
      const body: any = await (await post(guildCmd(), e)).json();
      expect(body.data.content).toBe("This check is not available to you yet.");
      expect(body.data.flags).toBe(64);
    }
  });
  it("adds the banner when a bot token is set, and never logs the payload", async () => {
    const logs: string[] = [];
    for (const m of ["log", "warn", "error", "info"] as const) vi.spyOn(console, m).mockImplementation((x) => { logs.push(String(x)); });
    const fetchImpl = (async (u: string) => { expect(String(u)).toBe(`https://discord.com/api/v10/users/${ID}`); return new Response(JSON.stringify({ banner: "h" })); }) as unknown as typeof fetch;
    const body: any = await (await post(guildCmd(), env({ DISCORD_BOT_TOKEN: "tok" }), {}, fetchImpl)).json();
    expect(body.data.content).toContain("Banner and colour");
    expect(body.data.content).not.toContain("Not checked: Banner");
    const all = logs.join("\n");
    expect(all).not.toContain("nelly");
    expect(all).not.toContain(ID);
    expect(all).not.toContain("tok");
  });
});
