# MPT — Agent Identity Landscape (MPC-6959)

Scan date: 2026-09-30. Supports Phases 5–7 of the proposed MPT phase map (Perplexity MPT Strategy, section 2D):
Phase 5 = Agent Footprint, Phase 6 = Agent Passport (credentials), Phase 7 = Agent Trust Network (verification API, revocation feeds, log anchoring).

Method and limits: findings come from web search result summaries, not full-page reads of each vendor site. Many summaries are from secondary sources (blogs, aggregators). Where pricing or stage was not in the results it is marked "not found". Items marked *(background knowledge, unsourced)* were not confirmed by a source in this scan and should be checked before anyone relies on them.

## 1. Players profiled (14)

| # | Player | Type | What it verifies / does | Who pays | Stage / pricing (as found) | Source |
|---|---|---|---|---|---|---|
| 1 | Okta / Auth0 | Identity provider | "Okta for AI Agents" and "Auth0 for AI Agents": Auth for MCP, agent as principal, on-behalf-of token exchange, Token Vault | Enterprises and developers | Shipping (May 2026 Auth0 release). Pricing not found | [Okta newsroom](https://www.okta.com/newsroom/articles/auth0-may-2026-product-innovations/), [Okta Secure AI](https://www.okta.com/solutions/secure-ai/) |
| 2 | Microsoft Entra Agent ID | Identity provider | First-class agent identities with Conditional Access, Governance, Identity Protection | Enterprises | Generally available. Delivered via Agent 365 (about $15 per user per month standalone, or in M365 E7 at $99) plus Entra P1/P2 | [Microsoft](https://www.microsoft.com/en-us/security/business/identity-access/microsoft-entra-agent-id), [Learn: what's new](https://learn.microsoft.com/en-us/entra/agent-id/whats-new-agent-id) |
| 3 | Visa Trusted Agent Protocol (TAP) | Payment network | Cryptographic agent identity on HTTPS requests, built on Web Bot Auth; agents register public keys in well-known directories | Merchants and issuers (implicit) | Open specification published. Pricing not found | [Visa developer specs](https://developer.visa.com/capabilities/trusted-agent-protocol/trusted-agent-protocol-specifications), [Digital Transactions](https://www.digitaltransactions.net/visa-launches-trusted-agent-an-agentic-commerce-protocol/) |
| 4 | Mastercard Agent Pay | Payment network | Agent registration and verification; Agentic Tokens bind a payment credential to an agent with per-session and per-merchant limits | Card ecosystem | Announced Apr 2025; reported US cardholder rollout Nov 2025 | [Mastercard press release](https://www.mastercard.com/us/en/news-and-trends/press/2025/april/mastercard-unveils-agent-pay-pioneering-agentic-payments-technology-to-power-commerce-in-the-age-of-ai.html), [Mastercard Agent Pay](https://www.mastercard.com/us/en/business/artificial-intelligence/mastercard-agent-pay.html) |
| 5 | Google AP2 | AI lab / protocol | Three signed mandates (Intent, Cart, Payment), each a W3C Verifiable Credential, proving a human authorised a purchase | Ecosystem (protocol is open) | Announced 2025-09-16 with 60+ partners; open protocol | [Google Cloud blog](https://cloud.google.com/blog/products/ai-machine-learning/announcing-agents-to-payments-ap2-protocol), [ap2-protocol.org](https://ap2-protocol.org/) |
| 6 | Cloudflare (Web Bot Auth) | Infrastructure | Signed-agent verification using HTTP Message Signatures (RFC 9421); foundation for Visa TAP and Mastercard Agent Pay | Site owners | Proposal May 2025; Visa/Mastercard collaboration announced 2025-10-24 | [PPC Land](https://ppc.land/cloudflare-partners-with-visa-and-mastercard-to-secure-ai-agent-shopping/), [Finextra](https://www.finextra.com/blogposting/29617/deep-dive-the-role-of-visas-trusted-agent-protocol-in-agentic-commerce) |
| 7 | Skyfire | Startup | Know Your Agent (KYA) identity plus payments over the open KYAPay protocol (OAuth 2.0, JWT, JWKS), USDC settlement | Agent builders and sellers | About $9.5M raised (secondary sources vary). Pricing not found | [Skyfire KYA docs](https://docs.skyfire.xyz/docs/kya), [Okta profile](https://www.okta.com/blog/company-and-culture/founders-in-focus-amir-sarhangi-ceo-of-skyfire/), [Business Wire](https://www.businesswire.com/news/home/20240821247203/en/Introducing-Skyfire-Payment-Rails-for-AI) |
| 8 | Keycard | Startup | Cryptographic agent verification, identity-bound tokens replacing static credentials, runtime access control | Developers and enterprises | $38M seed + Series A (a16z, boldstart, Acrew), Oct 2025. Pricing not found | [a16z](https://a16z.com/announcement/investing-in-keycard/), [FinTech Global](https://fintech.global/2025/10/23/keycard-secures-38m-to-advance-ai-agent-security/) |
| 9 | Aembit | Startup | Workload / non-human identity access for agents to enterprise services, including MCP | Enterprises | Shipping. Pricing not found | [Aembit vendor comparison](https://aembit.io/blog/10-identity-security-vendors-for-ai-agents-strengths-tradeoffs-and-how-they-fit/) (vendor's own blog, treat as marketing) |
| 10 | Astrix Security | Startup, reported Cisco-owned | Non-human and AI agent identity security | Enterprises | Ownership reported in one search summary only; verify | [Dock roundup](https://www.dock.io/post/best-ai-agent-identity-platforms-for-enterprises) |
| 11 | Vouched | Identity verification | "Know Your Agent" verification, KYA-OS delegation standard, KnowThat.ai public agent registry | Businesses receiving agent traffic | Launched May 2025. Pricing not found | [Vouched KYA](https://www.vouched.id/know-your-agent), [Business Wire](https://www.businesswire.com/news/home/20250522624223/en/Vouched-Launches-Know-Your-Agent-Verification-to-Bring-Trust-and-Identity-to-the-Next-Generation-of-AI-Agents) |
| 12 | World / Tools for Humanity | Proof of personhood | AgentKit links agents to a unique iris-verified human, with x402; reveals a real person, not who | Sites and agent platforms | Launched Mar 2026 with Coinbase; partners include Vercel, Okta, Browserbase, Exa | [CoinDesk](https://www.coindesk.com/tech/2026/03/17/sam-altman-s-world-teams-up-with-coinbase-to-prove-there-is-a-real-person-behind-every-ai-transaction), [The Paypers](https://thepaypers.com/fraud-and-fincrime/news/tools-for-humanitys-agentkit-verifies-humans-in-ai-commerce) |
| 13 | Persona | Identity verification (KYC) | Human ID verification and deepfake defence; candidate KYC provider behind agent credentials | Businesses | $200M Series D (per landscape summary) | [Landbase list](https://www.landbase.com/blog/fastest-growing-identity-verification-tech) |
| 14 | Trulioo | Identity verification (KYC/KYB) | Individuals and businesses in 195+ countries, 450+ data sources | Businesses | Established. Pricing not found | [Trulioo](https://www.trulioo.com/) |

Not found in this scan: any consumer-facing product that shows an individual which AI agents and apps have access to their accounts and helps revoke them. The vendors above sell to enterprises, merchants or developers.

## 2. Standards and specifications

| Standard | Layer | What it gives MPT | Maturity and adoption (as found) | Source |
|---|---|---|---|---|
| OAuth 2.1 / OAuth 2.0 extensions (RAR, PAR, DPoP) | Authorization, delegation | Basis for reading and revoking app access (Phase 5); delegated scope (Phase 6) | Mature. NIST NCCoE proposes it for agent authorization | [NIST concept paper coverage](https://www.biometricupdate.com/202603/nist-concept-paper-explores-identity-and-authorization-controls-for-ai-agents) |
| MCP authorization | Agent-to-tool auth | Where connected AI tools get access; a source to audit | OAuth 2.1 support added for the HTTP transport (Jan 2026 per source) | [arXiv 2604.23280](https://arxiv.org/pdf/2604.23280), [dev.to NCCoE summary](https://dev.to/willamhou/nist-nccoe-ai-agent-identity-authorization-what-developers-need-to-build-1kp1) |
| A2A Agent Card (`/.well-known/agent.json`, optional JWS signature) | Agent-to-agent discovery | Machine-readable agent identity metadata to score | Published spec, signing optional | [dev.to NCCoE summary](https://dev.to/willamhou/nist-nccoe-ai-agent-identity-authorization-what-developers-need-to-build-1kp1) |
| W3C Verifiable Credentials (and DIDs) | Portable signed claims | Format for the Passport credential; selective disclosure fits the privacy brand | Used by AP2. Governance, revocation and trust frameworks still open | [Google AP2](https://cloud.google.com/blog/products/ai-machine-learning/announcing-agents-to-payments-ap2-protocol), [arXiv 2604.23280](https://arxiv.org/pdf/2604.23280) |
| Google AP2 mandates | Payment authorization | Signed proof a human authorised a purchase; Layer B (principal) evidence | Announced Sep 2025, 60+ partners | [ap2-protocol.org](https://ap2-protocol.org/) |
| HTTP Message Signatures (RFC 9421) / Web Bot Auth | Agent request authentication | Key-directory model for proving an agent's key; local verification (tier 1) | Underpins Visa TAP and Mastercard Agent Pay | [PPC Land](https://ppc.land/cloudflare-partners-with-visa-and-mastercard-to-secure-ai-agent-shopping/) |
| Visa TAP and Mastercard Agentic Tokens | Payment-network agent identity | Where verified agents will be recognised by merchants | Live or rolling out (see table above) | [Visa](https://developer.visa.com/capabilities/trusted-agent-protocol/trusted-agent-protocol-specifications), [Mastercard](https://www.mastercard.com/us/en/news-and-trends/stories/2025/agentic-commerce-momentum.html) |
| SPIFFE / SPIFFE ID (SVID) | Workload identity | Operator-side identity for agents; key rotation | Operationally mature | [SecureW2 on IETF AIMS](https://securew2.com/blog/ietf-aims) |
| IETF WIMSE and AIMS draft (draft-klrc-aiagent-auth-00) | Workload and agent identity | Token exchange across trust domains; likely direction for enterprise interop | Working group and an individual draft, not final | [SecureW2](https://securew2.com/blog/ietf-aims) |
| NIST NCCoE agent identity and authorization | Guidance | Reference model: identification, authorization, delegation, logging | Concept paper (Feb 2026), not a standard | [Biometric Update](https://www.biometricupdate.com/202603/nist-concept-paper-explores-identity-and-authorization-controls-for-ai-agents), [ExecutiveGov](https://www.executivegov.com/articles/nist-nccoe-concept-paper-ai-agent-access-controls) |
| KYAPay / KYA (Skyfire), KYA-OS (Vouched) | Vendor-led KYA | Prior art for "know your agent" claims | Vendor-driven, not standards-body | [Skyfire](https://docs.skyfire.xyz/docs/kya), [Vouched](https://www.vouched.id/know-your-agent) |
| World ID / AgentKit with x402 | Proof of personhood | Optional "unique human" signal | Launched Mar 2026 | [CoinDesk](https://www.coindesk.com/tech/2026/03/17/sam-altman-s-world-teams-up-with-coinbase-to-prove-there-is-a-real-person-behind-every-ai-transaction) |

Not covered by a source in this scan, so verify before use: W3C Bitstring Status List (credential revocation) and Certificate-Transparency-style transparency logs (RFC 9162) as the model for tamper-evident logs *(background knowledge, unsourced)*.

## 3. Gaps a privacy-first player could take

1. **Consumer side of agent access.** Every profiled vendor sells to enterprises, merchants or developers. No consumer "see what my agents can reach, then revoke" product turned up. This is Phase 5 and matches MPT's See / Learn / Delete loop.
2. **Minimum-disclosure principal proof.** Vouched, Skyfire and Persona attach real-world identity to agents; World proves "a unique human" without saying who. A credential that proves "a verified, low-risk person stands behind this agent" without revealing who is not clearly served (W3C VC selective disclosure supports it). Inference from the sources, not a sourced claim.
3. **Human baseline as root of trust.** No profiled player ties an agent credential to a measured exposure or risk baseline of the human. This is unique to MPT's Phases 3–4 and feeds Phase 6.
4. **Neutral aggregation.** Payment networks, Okta, Microsoft and startups each define their own registry. A neutral trust-score layer over several of them is open.

## 4. Recommendation per phase

| Phase | Recommendation | Reasoning | Standards to use | Partners to evaluate |
|---|---|---|---|---|
| 5 — Agent Footprint | **Build** the product; **adopt** OAuth and provider permission APIs for the data | The data comes from users' own Google, Microsoft, Slack and GitHub permission pages (strategy 2D). No consumer competitor found. Keep it a small experiment until Phase 2 KPIs are met, per the guardrail | OAuth 2.x; MCP authorization and A2A Agent Cards as things to detect | None required. Later: Aembit or Astrix are enterprise NHI tools, so treat as reference points, not partners |
| 6 — Agent Passport | **Adopt** standards, **partner** for KYC, do not build a KYC stack or a new credential format | Inventing a format contradicts the task goal. Card networks and Google already converge on signed credentials and key directories | W3C Verifiable Credentials; AP2 mandates for payment intent; Web Bot Auth key directory (RFC 9421) so credentials are recognised by Visa TAP and Mastercard | KYC: Persona, Vouched or Trulioo. Optional personhood signal: World ID. Decide by pricing and privacy terms (none found yet) |
| 7 — Agent Trust Network | **Partner** and interoperate; build only the issuer, trust-score and revocation feed | Registries are being built by Visa, Mastercard, Cloudflare, Microsoft, Okta and Skyfire. A competing network is a poor bet. MPT's own strategy already says issuer and reputation authority, not hot path | SPIFFE / WIMSE and OAuth for enterprise interop; W3C VC with a revocation list; log anchoring design to be confirmed *(unsourced)* | Cloudflare, Visa, Mastercard (recognition by merchants); Skyfire and Keycard (integration or acquirer candidates). Watch IETF AIMS |

## 5. Open items

- Pricing was found only for Microsoft; every other row needs a vendor call or pricing-page check.
- Verify Astrix ownership, Skyfire funding total and Persona funding against primary sources.
- Liability framing ("attestation, not guarantee") is a legal question this scan does not answer.
- The Notion output page and the Strategy section 3 link are done.

## 6. Phase 5 technical details (MPC-6971)

Full write-up: `docs/phase5-oauth-permission-apis.md`. Google PoC: `workers/oauth-poc/`.

- **Stack:** Cloudflare Worker, OAuth 2.0 authorization code + PKCE (S256), non-sensitive scopes (`openid email profile`), online access, HMAC-signed state cookie, no stored tokens, MPT's own token revoked before responding.
- **Refinement of the Phase 5 recommendation:** OAuth authenticates the user and lets MPT revoke tokens it holds. Listing and revoking *other* apps' grants depends on the provider: no consumer API at Google (MPC-6960); Workspace `tokens.list` needs verification and CASA; Microsoft Graph `oauth2PermissionGrants` is the likeliest member-level list-and-revoke API **Pending Live Verification**; GitHub and Slack are likely guided-audit only **Pending Live Verification**.
- **Status:** PoC unit-tested with mocked provider calls; live run pending test-account credentials.
- **Risks:** provider APIs may not expose grants; MPT holding OAuth access is a trust risk (mitigated by no storage and revoke-on-finish); focus risk against the Phase 2 KPI.

## 6. Phase deep-dives (proposals for decision)

Sections 1–5 are sourced research. This section is a proposal built on that research and on the Notion strategy page (sections 2A–2D). Figures, timings and scores are design assumptions, not sourced facts. Written 2026-09-30.

### Phase 5 — Agent Footprint: build, adopting OAuth and provider permission APIs

**Objectives**
- Show a user which AI apps and agents can reach their Google, Microsoft, Slack and GitHub accounts, what they can do, and let them revoke.
- Add an "Your AI Agents" hexagon with a per-agent exposure score.
- Feed the scan funnel (lead magnet: MPC-6961).

**Tech stack (proposed)**
- Google, Microsoft, Slack and GitHub OAuth with read-only scopes to list third-party app grants; user-initiated revoke through each provider's own revoke endpoint.
- Detection of MCP servers and A2A Agent Cards where a user connects them.
- Existing MPT scoring engine and 46-hexagon model; new tables: agents linked to user, grants, dated snapshots (fits MPC-6811).
- Feasibility spike first: MPC-6960 (Google).

**Outcomes**
- "These N AI tools can read your email" report; one-click revoke; before/after score.
- Agent inventory linked to the user's Clean Baseline.

**Benefits**
- Uses standards already in place; no new format to invent.
- Consumer gap: no consumer see-and-revoke product found (section 3).
- Bridges today's product to Phases 6–7 and builds the data model early.

**Risks and mitigations**
- Provider APIs may not expose every grant, and scopes may need app review. Mitigation: spike one provider first.
- MPT holding OAuth access is itself a trust risk. Mitigation: read-only scopes, no token storage beyond the session, clear consent copy; fix the open secret-rotation item first.
- Focus risk against the Phase 2 KPI (10K scans, 1K paid, $120K ARR by 2027-08-01). Mitigation: experiments only until the KPI is on track.

### Phase 6 — Agent Passport: adopt standards, partner for KYC

**Value**
- Recurring revenue per verified identity and per credential issued, rather than per transaction.
- Differentiator: proves "a verified, low-risk person stands behind this agent" with minimum disclosure, rooted in the Phase 4 Clean Baseline.
- Recognition by payment networks if credentials map to Web Bot Auth key directories (Visa TAP, Mastercard Agent Pay).

**ROI (how to model it; no numbers yet)**
- Cost side: KYC per-check fees (pricing not yet found), credential issuance and key management, legal and compliance.
- Revenue side: per-credential or per-agent subscription add-on to the Phase 4 subscription.
- Build-versus-partner saving: not building KYC or a credential format avoids the two largest engineering and compliance costs.
- Decision input needed: KYC vendor pricing before any ROI figure is quoted.

**Risks**
- Liability if MPT vouches for an agent that commits fraud. Mitigation: "attestation, not guarantee" wording, legal review.
- Standards churn (W3C VC governance and revocation still open; IETF AIMS is a draft). Mitigation: thin adapter layer.
- KYC vendor lock-in and privacy terms. Mitigation: two vendors behind one interface.
- Depends on Phases 3–4 shipping; no clean human baseline means no root of trust.

### Phase 7 — Agent Trust Network: partner and interoperate; build only issuer, trust score and revocation feed

**Explanation.** Visa, Mastercard, Cloudflare, Microsoft, Okta and Skyfire already run or define registries. MPT does not compete on the transaction path. It acts as issuer and reputation authority, like a certificate authority plus a credit bureau.

**Strategy**
1. Interoperate first: publish credentials others can verify locally (W3C VC, Web Bot Auth key directory, OAuth/SPIFFE for enterprise).
2. Run three services only: credential issuance, revocation feed, trust-score API.
3. Integrate with existing registries rather than replace them (Cloudflare, Visa, Mastercard, Skyfire, Keycard as candidates).

**Decision**
- Build: issuer, trust score, revocation feed. Partner: merchant recognition, KYC, payments. Do not build: a competing network, a new standard, a hot-path verifier.
- Revisit at Phase 6 exit, once real integration demand is measured.

**Objectives**
- Answer "can I trust this agent and who stands behind it" in milliseconds through cached feeds, without MPT in the hot path.
- Keep private, tamper-evident logs with periodic public hash anchoring (log design still to confirm).

**Trust score mechanism (proposed)**
- Inputs by layer: A identity (key bound, builder credential); B principal and liability (verified human or company, signed delegation, Clean Baseline score); C compute and incentives (declared, attested where possible); D track record (co-signed receipts, incident history).
- Output: a signed score credential plus reason codes and an expiry, so the checker verifies locally and only asks MPT on revocation or dispute.
- Score changes only through logged events; every change is explainable; subjects can appeal.
- Incentives (layer C) are declared and monitored, not proven; the score must say so.
- Weights and thresholds are set after Phase 5 data exists; none are fixed here.

**Change management**
- Versioned scoring model with a public changelog and a notice period before weights change.
- Staged rollout: shadow scoring, then advisory, then relied upon.
- Appeals and correction process for agent owners; revocation runbook with response-time targets.
- Quarterly standards watch (IETF AIMS/WIMSE, NIST NCCoE, Visa/Mastercard specs); adapter layer so a standards change does not force a rebuild.
- Governance: legal framing and a named owner for scoring decisions before Phase 7 launch.
