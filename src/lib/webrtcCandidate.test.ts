import { describe, expect, it } from "vitest";
import { parseIceCandidateAddress } from "./fingerprintDetection";

// CK-8305: the old regex read "e:2507372607" out of "candidate:2507372607" and counted it as a public address.
describe("parseIceCandidateAddress", () => {
  it("ignores an mDNS placeholder candidate (the string that showed 'Leaking: e:2507372607')", () => {
    const c = "candidate:2507372607 1 udp 2113937151 3f2a1c0e-9b7d-4c1e-8a55-1d2e3f4a5b6c.local 54321 typ host generation 0 ufrag abcd network-cost 999";
    expect(parseIceCandidateAddress(c)).toBeNull();
  });

  it("returns a public IPv4 for a server-reflexive candidate and ignores raddr", () => {
    const c = "candidate:842163049 1 udp 1677729535 203.0.113.7 54321 typ srflx raddr 0.0.0.0 rport 0 generation 0";
    expect(parseIceCandidateAddress(c)).toEqual({ address: "203.0.113.7", kind: "public" });
  });

  it.each(["10.1.2.3", "192.168.1.5", "172.16.0.9", "172.31.255.1", "169.254.1.1", "127.0.0.1", "100.64.0.1"])(
    "treats %s as local",
    (ip) => {
      expect(parseIceCandidateAddress(`candidate:1 1 udp 2113937151 ${ip} 5000 typ host`)).toEqual({ address: ip, kind: "local" });
    }
  );

  it("treats 172.32.x.x as public (outside 172.16/12)", () => {
    expect(parseIceCandidateAddress("candidate:1 1 udp 1 172.32.0.1 5000 typ srflx")?.kind).toBe("public");
  });

  it("classifies IPv6: global is public, link-local and unique-local are local", () => {
    expect(parseIceCandidateAddress("candidate:1 1 udp 1 2001:db8::1 5000 typ host")).toEqual({ address: "2001:db8::1", kind: "public" });
    expect(parseIceCandidateAddress("candidate:1 1 udp 1 fe80::1 5000 typ host")?.kind).toBe("local");
    expect(parseIceCandidateAddress("candidate:1 1 udp 1 fd12:3456::1 5000 typ host")?.kind).toBe("local");
    expect(parseIceCandidateAddress("candidate:1 1 udp 1 ::1 5000 typ host")?.kind).toBe("local");
  });

  it("rejects non-addresses: bad octets, hostnames, foundation ids, empty input", () => {
    expect(parseIceCandidateAddress("candidate:1 1 udp 1 999.1.1.1 5000 typ host")).toBeNull();
    expect(parseIceCandidateAddress("candidate:1 1 udp 1 example.com 5000 typ host")).toBeNull();
    expect(parseIceCandidateAddress("candidate:2507372607")).toBeNull();
    expect(parseIceCandidateAddress("")).toBeNull();
  });
});
