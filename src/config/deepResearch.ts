// Deep Research suite (MPC-9546). The five deep hexagons, in the approved order (2026-11-04, Chris).
//
// NO-SPEND DECISION (2026-11-07): no paid API is bought or provisioned yet. Each hexagon below is either
//   "free_now"    -> something useful already runs with no key and no cost, or
//   "coming_soon" -> it needs a paid or licensed provider; the page shows a "Coming soon" popup instead.
// Flip `availability` to "free_now" only when the provider is chosen, a key is provisioned and the
// synthetic-payload test for that hexagon passes. Provider names here are plans, not commitments.
//
// This list is deliberately separate from shared/hexagon-registry (the 54 web / 368 catalogue hexagons):
// it is outside every score and count until the owner approves registry entries for these (MPC-9546).

export type DeepAvailability = "free_now" | "coming_soon";

export interface DeepHexagon {
  id: string;
  rank: number;
  label: string;
  summary: string;
  availability: DeepAvailability;
  tier: "deep" | "premium";
  /** Shown on the free action's card. */
  freeAction?: { kind: "password_check" | "link"; label: string; to?: string };
  /** Shown in the "Coming soon" popup: what will switch on and what it needs. */
  comingSoon?: { title: string; body: string; needs: string };
  /** Planned data source, for the team. Not a purchase decision. */
  plannedProvider: string;
  build_state: "planned" | "built";
}

export const DEEP_HEXAGONS: readonly DeepHexagon[] = [
  {
    id: "cred_leak_trace",
    rank: 1,
    label: "Credential & Identity Leak Tracing",
    summary: "Find out whether a password you use has appeared in a known data breach.",
    availability: "free_now",
    tier: "deep",
    freeAction: { kind: "password_check", label: "Check a password" },
    comingSoon: {
      title: "Full leak trace: coming soon",
      body: "Which breaches your email is in, what was exposed and when it first leaked. This part uses a licensed breach database and switches on once that is connected.",
      needs: "Licensed breach data provider",
    },
    plannedProvider: "Pwned Passwords k-anonymity (free, live now); licensed breach feed for the full trace (not bought)",
    build_state: "planned",
  },
  {
    id: "darkweb_breach_map",
    rank: 2,
    label: "Dark Web Breach Mapping",
    summary: "Where your data is circulating: stealer logs, paste sites and markets.",
    availability: "coming_soon",
    tier: "deep",
    comingSoon: {
      title: "Dark Web Breach Mapping: coming soon",
      body: "We map where exposed data is circulating using licensed threat-intelligence feeds. We never browse criminal sites ourselves. It switches on when the data feed is connected.",
      needs: "Licensed threat-intelligence feed",
    },
    plannedProvider: "Licensed threat-intel feed (not chosen, not bought)",
    build_state: "planned",
  },
  {
    id: "osint_social_graph",
    rank: 3,
    label: "Advanced OSINT & Social Graph",
    summary: "What a stranger could piece together about you from public traces.",
    availability: "coming_soon",
    tier: "deep",
    comingSoon: {
      title: "Social Graph: coming soon",
      body: "Links between your name, email, usernames and public profiles. It switches on when the lookup provider is connected, and only ever for an identity you have verified as yours.",
      needs: "Identity lookup provider + verified ownership",
    },
    plannedProvider: "Public-profile lookup provider (not chosen, not bought)",
    build_state: "planned",
  },
  {
    id: "network_device_fp",
    rank: 4,
    label: "Network & Device Fingerprinting",
    summary: "What your browser and connection reveal about your device and location.",
    availability: "free_now",
    tier: "deep",
    freeAction: { kind: "link", label: "Run the free device & network scan", to: "/scan" },
    comingSoon: {
      title: "Deep fingerprinting: coming soon",
      body: "Exposed services, reputation and passive DNS checks. These need third-party network data and switch on when it is connected.",
      needs: "Network intelligence provider",
    },
    plannedProvider: "Existing free scan (live now); network-intel provider for the deeper layer (not bought)",
    build_state: "planned",
  },
  {
    id: "crypto_asset_flow",
    rank: 5,
    label: "Cryptocurrency & Asset Flow Tracking",
    summary: "Whether your wallets or identity are linked to risky addresses.",
    availability: "coming_soon",
    tier: "premium",
    comingSoon: {
      title: "Crypto exposure: coming soon",
      body: "A premium add-on. It checks wallet exposure with a blockchain analytics provider and switches on when that is connected.",
      needs: "Blockchain analytics provider (premium add-on)",
    },
    plannedProvider: "Blockchain analytics provider (not chosen, not bought)",
    build_state: "planned",
  },
] as const;

export const FREE_NOW_COUNT = DEEP_HEXAGONS.filter((h) => h.availability === "free_now").length;
