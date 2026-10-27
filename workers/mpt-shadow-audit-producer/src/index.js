// Producer front door for mpt-shadow-audit-queue (MPC-8644).
// The Cloud Run polling job POSTs completed audits here with a shared secret;
// the queue binding means no Cloudflare API token ever leaves Cloudflare.

const ALLOWED_OUTCOMES = new Set(["pass", "warn", "fail"]);
const ALLOWED_ENVS = new Set(["staging", "prod"]);

async function secretsEqual(a, b) {
  const enc = new TextEncoder();
  const [ha, hb] = await Promise.all([
    crypto.subtle.digest("SHA-256", enc.encode(a)),
    crypto.subtle.digest("SHA-256", enc.encode(b)),
  ]);
  const va = new Uint8Array(ha);
  const vb = new Uint8Array(hb);
  let diff = 0;
  for (let i = 0; i < va.length; i++) diff |= va[i] ^ vb[i];
  return diff === 0;
}

function validate(body) {
  if (!body || typeof body !== "object") return "body must be a JSON object";
  if (typeof body.audit_id !== "string" || !/^[A-Za-z0-9_-]{1,100}$/.test(body.audit_id)) return "audit_id invalid";
  if (typeof body.created_at !== "string" || Number.isNaN(Date.parse(body.created_at))) return "created_at invalid";
  if (!ALLOWED_OUTCOMES.has(body.outcome)) return "outcome invalid";
  if (!ALLOWED_ENVS.has(body.env)) return "env invalid";
  const scores = body.pillar_scores;
  if (!scores || typeof scores !== "object" || Array.isArray(scores)) return "pillar_scores invalid";
  const entries = Object.entries(scores);
  if (entries.length === 0 || entries.length > 20) return "pillar_scores size invalid";
  for (const [k, v] of entries) {
    if (!/^[a-z0-9_]{1,40}$/.test(k) || typeof v !== "number" || v < 0 || v > 100) return "pillar_scores entry invalid";
  }
  return null;
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname !== "/enqueue") return new Response("not found", { status: 404 });
    if (request.method !== "POST") return new Response("method not allowed", { status: 405 });

    const auth = request.headers.get("Authorization") || "";
    const presented = auth.startsWith("Bearer ") ? auth.slice(7) : "";
    if (!env.PRODUCER_SECRET || !(await secretsEqual(presented, env.PRODUCER_SECRET))) {
      return new Response("unauthorized", { status: 401 });
    }

    let body;
    try {
      body = await request.json();
    } catch {
      return new Response("invalid json", { status: 400 });
    }
    const problem = validate(body);
    if (problem) return new Response(problem, { status: 400 });

    // Allowlist: only these fields ever reach the queue (no agent-identifying data).
    await env.AUDIT_QUEUE.send(
      {
        audit_id: body.audit_id,
        created_at: body.created_at,
        outcome: body.outcome,
        env: body.env,
        pillar_scores: body.pillar_scores,
      },
      { contentType: "json" }
    );
    return Response.json({ queued: body.audit_id }, { status: 202 });
  },
};
