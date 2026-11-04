import type { DefectHandoff } from "../../src/lib/supportDefectHandoff";
import type { EngineeringIntake } from "./engineering-intake";

// MPC-8529: one concrete EngineeringIntake: a GitHub issue in a configured repository, for human engineering review.
// NOT ACTIVATED: nothing constructs this, and creating issues needs a token, a named repository and approval. The payload is already
// sanitised (src/lib/supportDefectHandoff.ts); this adds no new data. It creates an issue and nothing else: no assignee, no
// mention of a person, no pull request, no workflow dispatch, no fix. A failed or unconfirmed call THROWS, so reportDefect
// reports "not sent" instead of pretending.

export interface GithubIssueIntakeConfig {
  /** "owner/repo". The only place this intake can write. */
  repo: string;
  /** Fine-grained token limited to issues:write on that repo. Never logged or put in an issue. */
  token: string;
  /** Label that marks support defects and is used to find an existing open issue for the same case. */
  label?: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

const REPO = /^[A-Za-z0-9_.-]{1,100}\/[A-Za-z0-9_.-]{1,100}$/;

export class GithubIssueIntake implements EngineeringIntake {
  private f: typeof fetch;
  private label: string;
  constructor(private c: GithubIssueIntakeConfig) {
    if (!REPO.test(c.repo)) throw new Error("repo must be owner/repo");
    if (!c.token) throw new Error("token required");
    this.f = c.fetchImpl ?? fetch;
    this.label = c.label ?? "support-defect";
  }

  private async call(method: string, path: string, body?: unknown): Promise<unknown> {
    const res = await this.f(`https://api.github.com/repos/${this.c.repo}/${path}`, {
      method,
      headers: { Authorization: `Bearer ${this.c.token}`, Accept: "application/vnd.github+json", "Content-Type": "application/json", "User-Agent": "mpt-support-followup" },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(this.c.timeoutMs ?? 8000),
    });
    if (!res.ok) throw new Error(`github issues ${method} ${path.split("?")[0]} failed: ${res.status}`);
    return res.json();
  }

  async submit(h: DefectHandoff): Promise<{ reference: string }> {
    const marker = `<!-- mpt-support-defect:${h.caseRef}:${h.area} -->`;
    // One open issue per (case, area): a repeat attaches nothing new and returns the existing issue.
    const open = (await this.call("GET", `issues?state=open&labels=${encodeURIComponent(this.label)}&per_page=100`)) as { number: number; body?: string | null; pull_request?: unknown }[];
    if (!Array.isArray(open)) throw new Error("unexpected issues response");
    const existing = open.find((i) => !i.pull_request && typeof i.body === "string" && i.body.includes(marker));
    if (existing) return { reference: `#${existing.number}` };

    const body = [
      marker,
      `Case reference: ${h.caseRef} · area: ${h.area} · occurrences: ${h.occurrences}`,
      h.firstSeen || h.lastSeen ? `First seen: ${h.firstSeen ?? "unknown"} · last seen: ${h.lastSeen ?? "unknown"}` : "",
      "", "## Summary", h.summary,
      h.reproSteps.length ? "\n## Reproduction\n" + h.reproSteps.map((s, i) => `${i + 1}. ${s}`).join("\n") : "",
      h.observed ? `\n## Observed\n${h.observed}` : "",
      h.expected ? `\n## Expected\n${h.expected}` : "",
      "", "---",
      `Sanitised automatically (${h.redactions} item(s) removed). For engineering review only: no automatic fix, no production change and no customer contact comes from this issue.`,
    ].filter((l) => l !== "").join("\n");

    const created = (await this.call("POST", "issues", { title: h.title.slice(0, 200), body, labels: [this.label] })) as { number?: number };
    if (typeof created?.number !== "number") throw new Error("github did not confirm the issue");
    return { reference: `#${created.number}` };
  }
}
