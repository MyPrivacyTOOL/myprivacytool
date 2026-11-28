// Consumer for mpt-shadow-audit-queue (MPC-8367): writes one Analytics Engine
// datapoint per audit. Only allowlisted fields arrive (the producer drops the
// rest), and nothing agent-identifying is written.
//
// Datapoint layout (query with the SQL API, dataset mpt_shadow_audit):
//   index1   = audit_id
//   blob1    = outcome (pass|warn|fail)
//   blob2    = env (staging|prod)
//   blob3..  = pillar names, sorted
//   double1  = overall score (mean of pillar scores)
//   double2..= pillar scores, same order as blob3..

const MAX_PILLARS = 18; // blobs 3..20 / doubles 2..19 limit headroom

function toDatapoint(msg) {
  const names = Object.keys(msg.pillar_scores).sort().slice(0, MAX_PILLARS);
  const scores = names.map((n) => msg.pillar_scores[n]);
  const overall = scores.reduce((a, b) => a + b, 0) / scores.length;
  return {
    indexes: [msg.audit_id],
    blobs: [msg.outcome, msg.env, ...names],
    doubles: [overall, ...scores],
  };
}

function valid(msg) {
  return (
    msg &&
    typeof msg.audit_id === "string" &&
    typeof msg.outcome === "string" &&
    typeof msg.env === "string" &&
    msg.pillar_scores &&
    typeof msg.pillar_scores === "object" &&
    Object.keys(msg.pillar_scores).length > 0
  );
}

export default {
  async queue(batch, env) {
    for (const message of batch.messages) {
      if (!valid(message.body)) {
        console.error("dropping malformed message", { id: message.id });
        message.ack();
        continue;
      }
      try {
        env.AUDIT_METRICS.writeDataPoint(toDatapoint(message.body));
        message.ack();
      } catch (err) {
        console.error("write failed", { id: message.id, error: String(err) });
        message.retry();
      }
    }
  },
};
