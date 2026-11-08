// MPC-9884 layer 3 (design 1.4): the Worker / Function runtime spy. Workers already take an injected fetchImpl; a handler test passes
// `spy.fetch` instead of a hand-rolled mock and, at the end, `spy.assertAllRegistered()` fails if ANY call went to a host that is not in
// shared/recipients/recipients.json, or to a recipient that is switched off (enabled:false). `spy.calls` is the list of hosts contacted so a test
// can also assert WHICH recipient was reached. It never touches the network: it answers from `respond` (default: 200 {}).
import recipientsData from "./recipients.json" with { type: "json" };
import { hostMatches, type Recipient, type RecipientRegistry } from "./registry.ts";

export interface SpyCall { url: string; host: string; method: string; recipient: string | null; enabled: boolean | null }
export interface FetchSpyOptions {
  registry?: RecipientRegistry;
  respond?: (url: string, init?: RequestInit) => Response | Promise<Response>;
  /** Hosts the test itself serves (a stub origin); never counted as a recipient. */
  ignoreHosts?: string[];
}

export function createFetchSpy(opts: FetchSpyOptions = {}) {
  const registry = opts.registry ?? (recipientsData as unknown as RecipientRegistry);
  const calls: SpyCall[] = [];
  const spy = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const raw = typeof input === "string" ? input : input instanceof URL ? input.href : (input as Request).url;
    const method = (init?.method ?? (typeof input === "object" && "method" in input ? (input as Request).method : "GET")).toUpperCase();
    let host = "";
    try { host = new URL(raw).hostname.toLowerCase(); } catch { /* relative or malformed: recorded with an empty host and fails the assertion */ }
    const owner: Recipient | undefined = host ? registry.recipients.find((r) => r.hosts.length > 0 && hostMatches(host, r.hosts)) : undefined;
    calls.push({ url: raw, host, method, recipient: owner?.key ?? null, enabled: owner ? owner.enabled : null });
    return opts.respond ? opts.respond(raw, init) : new Response("{}", { status: 200, headers: { "content-type": "application/json" } });
  };
  const counted = () => calls.filter((c) => !opts.ignoreHosts?.some((h) => hostMatches(c.host, [h])));
  return {
    fetch: spy as typeof fetch,
    calls,
    unregistered: () => counted().filter((c) => c.recipient === null),
    disabled: () => counted().filter((c) => c.enabled === false),
    /** Throws listing every call to an unregistered host or a switched-off recipient. Call it at the end of a handler test. */
    assertAllRegistered() {
      const bad = [...this.unregistered().map((c) => `${c.method} ${c.url} (host "${c.host}" is not in the recipient registry)`),
        ...this.disabled().map((c) => `${c.method} ${c.url} (recipient "${c.recipient}" is enabled:false)`)];
      if (bad.length) throw new Error(`fetch-spy: ${bad.length} outbound call(s) outside the registry:\n- ${bad.join("\n- ")}`);
    },
  };
}
