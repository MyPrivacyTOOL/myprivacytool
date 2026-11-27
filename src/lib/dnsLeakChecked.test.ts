// MPC-9791 (TECH-005): a blocked or failed probe is NOT CHECKED, never "no leak". The result carries `checked`; only a STUN-enabled probe that saw an ICE candidate sets it.
import { describe, it, expect, vi, beforeEach } from "vitest";

const state = { webrtc: true, consent: true, candidates: [] as string[], throwOnCreate: false };

vi.mock("@/lib/scanConsent", () => ({ hasScanConsent: () => state.consent }));
vi.mock("@/lib/recipientClient", () => ({
  webRtcAvailable: () => state.webrtc,
  recipientPeerConnection: async () => {
    if (state.throwOnCreate) throw new Error("blocked");
    const pc: Record<string, unknown> = {
      iceGatheringState: "new",
      close: () => undefined,
      createDataChannel: () => undefined,
      createOffer: async () => ({}),
      setLocalDescription: async () => {
        for (const c of state.candidates) (pc.onicecandidate as (e: unknown) => void)({ candidate: { candidate: c } });
        pc.iceGatheringState = "complete";
        (pc.onicegatheringstatechange as () => void)();
      },
    };
    return pc;
  },
}));

import { detectDNSLeak } from "./securityDetection";

const PUBLIC = "candidate:1 1 udp 1677729535 203.0.113.7 54321 typ srflx raddr 0.0.0.0 rport 0";
const MDNS = "candidate:2 1 udp 2113937151 3f2a1c0e-1111-4222-8333-444455556666.local 54322 typ host";

beforeEach(() => { state.webrtc = true; state.consent = true; state.candidates = []; state.throwOnCreate = false; });

describe("detectDNSLeak: checked", () => {
  it("WebRTC unavailable is not checked and not leaking", async () => {
    state.webrtc = false;
    const r = await detectDNSLeak();
    expect(r.checked).toBe(false);
    expect(r.isLeaking).toBe(false);
  });

  it("a probe that cannot be created (blocked by the browser or an extension) is not checked", async () => {
    state.throwOnCreate = true;
    expect((await detectDNSLeak()).checked).toBe(false);
  });

  it("a probe that gathers no candidates is not checked", async () => {
    state.candidates = [];
    expect((await detectDNSLeak()).checked).toBe(false);
  });

  it("before the Scan me press no STUN server is used, so the probe is not checked even if candidates appear", async () => {
    state.consent = false;
    state.candidates = [MDNS];
    expect((await detectDNSLeak()).checked).toBe(false);
  });

  it("after consent a probe that saw a candidate is checked", async () => {
    state.candidates = [MDNS];
    const r = await detectDNSLeak();
    expect(r.checked).toBe(true);
    expect(r.isLeaking).toBe(false);
  });

  it("a public address seen with a local one is still reported as leaking, and checked", async () => {
    state.candidates = [PUBLIC, "candidate:3 1 udp 2113937151 192.168.1.20 54323 typ host"];
    const r = await detectDNSLeak();
    expect(r.checked).toBe(true);
    expect(r.isLeaking).toBe(true);
  });
});
