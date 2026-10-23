# MPC-8365: A/B Test Conversion Report
## Scan Reveal Batch 1 OSINT vs. Legacy

**Test Window:** 2026-10-26 to 2026-11-09 (2 weeks)  
**Hypothesis:** Batch 1 OSINT reveal flow (Variant A) drives higher conversion than legacy reveal (Variant B)  
**Primary Metric:** Conversion rate (scan submitted → paid plan within 72h)

---

## Data Collection

### GA4 Events Captured
- `ab_variant_assigned` — fired on /api/scan POST, records variant (A|B) and anonymous client ID
- `page_view` — standard GA4 event for reveal page load
- `ecommerce_conversion` — planned standard event for paid plan signup

### Supabase Raw Data
- `public.scans` — email submission timestamp, variant assignment
- `public.conversions` — paid plan signups linked by email or client ID

### Queries to Run (Every 48h)

**Variant A (OSINT Reveal) Conversion:**
```sql
SELECT 
  COUNT(DISTINCT s.email) as emails_assigned,
  COUNT(DISTINCT c.email) as emails_converted,
  ROUND(100.0 * COUNT(DISTINCT c.email) / COUNT(DISTINCT s.email), 2) as conversion_rate,
  AVG(EXTRACT(DAY FROM c.created_at - s.created_at)) as avg_days_to_convert
FROM public.scans s
LEFT JOIN public.conversions c ON s.email = c.email AND c.created_at <= s.created_at + INTERVAL '72 hours'
WHERE s.variant = 'A'
  AND s.created_at >= NOW() - INTERVAL '2 weeks'
GROUP BY 1;
```

**Variant B (Legacy Reveal) Conversion:**
```sql
SELECT 
  COUNT(DISTINCT s.email) as emails_assigned,
  COUNT(DISTINCT c.email) as emails_converted,
  ROUND(100.0 * COUNT(DISTINCT c.email) / COUNT(DISTINCT s.email), 2) as conversion_rate,
  AVG(EXTRACT(DAY FROM c.created_at - s.created_at)) as avg_days_to_convert
FROM public.scans s
LEFT JOIN public.conversions c ON s.email = c.email AND c.created_at <= s.created_at + INTERVAL '72 hours'
WHERE s.variant = 'B'
  AND s.created_at >= NOW() - INTERVAL '2 weeks'
GROUP BY 1;
```

---

## Conversion Comparison Table

| Metric | Variant A (OSINT) | Variant B (Legacy) | Difference | Winner |
|--------|-------------------|-------------------|------------|--------|
| Emails Assigned | — | — | — | — |
| Emails Converted (72h) | — | — | — | — |
| Conversion Rate | — | — | — | — |
| Avg Days to Convert | — | — | — | — |
| Statistical Significance (χ²) | — | — | — | — |

---

## Acceptance Criteria (MPC-8365)

- [ ] 200+ live requests distributed across A/B (verification via GA4 or server logs)
- [ ] Kill switch tested (D1 mode: `active` → `legacy` → `active`)
- [ ] Conversion rate for A > B by >5% (or both within 2%, call it a tie)
- [ ] Average time-to-convert is lower for A than B
- [ ] All GA4 events fire without 401/403 errors
- [ ] Report published to <https://www.notion.so/[page-id]>

---

## Notes

- **Privacy:** Only variant ID (A|B) is recorded in analytics; emails never sent to GA4
- **Window:** Test runs until 2026-11-09. Results may shift; report refreshed every 48h until window closes
- **Kill Switch:** If either variant shows error rates >5%, flip to `legacy` mode via D1 update
- **Statistical Significance:** Using chi-square test; p<0.05 threshold for significance claim

---

## Updates

- **2026-10-23:** Template created, D1 schema defined, test harness ready
- **2026-10-26:** Worker deployed to production; live data collection begins
- **[DATE]:** First interim report (48h data)
- **[DATE]:** Final report (14-day window closed)
