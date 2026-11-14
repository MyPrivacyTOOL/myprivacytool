# mpt-shadow-audit-consumer

Queue consumer for `mpt-shadow-audit-queue` (MPC-8367). Writes one Cloudflare Analytics Engine datapoint per audit to dataset `mpt_shadow_audit`; no agent-identifying data.

Datapoint: `index1`=audit_id, `blob1`=outcome, `blob2`=env, `blob3..`=sorted pillar names, `double1`=overall (mean of pillars), `double2..`=pillar scores.

Audits per day and average overall score (SQL API, `POST /accounts/<id>/analytics_engine/sql`, needs an Account Analytics Read token):

```sql
SELECT toDate(timestamp) AS day,
       sum(_sample_interval) AS audits,
       sum(_sample_interval * double1) / sum(_sample_interval) AS avg_overall_score
FROM mpt_shadow_audit
WHERE index1 NOT LIKE 'e2e-test-%'
GROUP BY day ORDER BY day DESC
```

Test audits use the `e2e-test-` prefix. Retries 3 times, then dead-letters to `mpt-shadow-audit-dlq`.
