// Shared stubbed backend for the scan-report tests: PostgREST tables, Resend, HubSpot and the public lookups. No network, no secrets.
// Extracted unchanged from worker.test.mjs (MPC-6677..8452) so lifecycle.test.mjs can reuse it. Two opt-in hooks, both off by default:
//   opts.resendIdempotent  the same Idempotency-Key returns the first message id and counts as one email (what Resend does)
//   opts.onRequest(url, init, res, db)  return a response to replace the call (inject a fault), or nothing to carry on
export function fake(opts = {}) {
  const db = { users: [], leads: [], scans: [], signals: [], hexagon_scores: [], email_suppressions: [], subscribers: [], web_scans: [], web_scan_contacts: [], web_scan_events: [], web_scan_returns: [], referrals: [] }; const calls = []; let n = 0; const seenKeys = new Map();
  const f = async (url, o = {}) => {
    url = String(url); calls.push({ url, method: o.method || 'GET', body: o.body, headers: o.headers });
    const res = (status, body) => ({ ok: status < 400, status, headers: { get: () => null }, text: async () => (body === undefined ? '' : JSON.stringify(body)), json: async () => body });
    if (opts.onRequest) { const r = await opts.onRequest(url, o, res, db); if (r) return r; }   // lifecycle tests: inject a fault or a crash at an exact call
    if (url.includes('api.resend.com')) {
      if (opts.resendFail) return res(500, 'x');
      const key = o.headers?.['Idempotency-Key'];
      if (opts.resendIdempotent && key) { if (!seenKeys.has(key)) seenKeys.set(key, `msg_${++n}`); return res(200, { id: seenKeys.get(key) }); }   // like Resend: the same key returns the first message, no second email
      return res(200, { id: `msg_${++n}` });
    }
    if (url.includes('api.hubapi.com')) return res(200, url.includes('/contacts/search') && opts.hsContact !== false ? { results: [{ id: '42' }] } : {});
    if (url.includes('cloudflare-dns.com')) return res(200, { Status: 0, Answer: [] });   // MPC-7467 email hexagons
    if (url.includes('gravatar.com')) return res(404);
    if (url.includes('libravatar.org')) return res(404);   // MPC-8452 email hexagons
    if (url.includes('rdap.org')) return res(404);
    if (url.includes('haveibeenpwned.com')) return opts.hibp ? opts.hibp() : res(404);
    if (url.includes('/rpc/mpt_complete_referral')) {   // MPC-7645: same rules as the SQL function
      const id = JSON.parse(o.body).p_referee_user_id; const r = db.referrals.find((x) => x.referee_user_id === id && x.status === 'signed_up'); if (!r) return res(200, []);
      r.status = 'completed'; const u = db.users.find((x) => x.id === r.referrer_user_id); u.pro_months_earned = (u.pro_months_earned || 0) + 1; return res(200, [{ referrer_user_id: u.id, rewarded: true, pro_months_earned: u.pro_months_earned }]);
    }
    if (url.includes('/rpc/claim_onboarding_cohort')) { if (opts.rpcFail) return res(500, 'x'); const u = db.users.find((x) => x.id === JSON.parse(o.body).p_user_id); if (!u.cohort_number) { const n = Math.max(0, ...db.users.map((x) => x.cohort_number || 0)) + 1; if (n > 100) return res(200, null); u.cohort_number = n; } return res(200, u.cohort_number); }
    const m = url.match(/rest\/v1\/(\w+)(\?.*)?$/); const t = m[1]; const q = new URLSearchParams(m[2] || '');
    if (o.method === 'DELETE' && q.get('email')) { const v = decodeURIComponent(q.get('email').replace(/^(eq|ilike)\./, '')).replace(/\\(.)/g, '$1').toLowerCase(); db[t] = db[t].filter((x) => String(x.email).toLowerCase() !== v); return res(204); }   // CK-7721 fix 3
    if (o.method === 'DELETE') { const id = q.get('id')?.replace('eq.', ''); const sid = q.get('scan_id')?.replace('eq.', ''); db[t] = db[t].filter((x) => (sid ? x.scan_id !== sid : x.id !== id)); return res(204); }
    if (o.method === 'POST') { const rows = [].concat(JSON.parse(o.body)).map((x) => ({ id: `id${++n}`, report_status: 'pending', report_attempts: 0, created_at: new Date().toISOString(), ...x }));
      if (t === 'web_scans' || t === 'scans') rows.forEach((x) => { x.id = crypto.randomUUID(); });   // production ids are uuids (MPC-8452 checks the shape)
      if (t === 'web_scan_contacts') { if (opts.linkFail) return res(500, 'x'); const x = rows[0]; if (!db.web_scans.some((w) => w.id === x.web_scan_id)) return res(409, { code: '23503' }); if (db.web_scan_contacts.some((c) => c.web_scan_id === x.web_scan_id && c.channel === x.channel && c.contact_id === x.contact_id)) return res(409, { code: '23505' }); }
      if (t === 'web_scan_events') { const x = rows[0]; if (!db.web_scans.some((w) => w.id === x.web_scan_id)) return res(409, { code: '23503' }); if (db.web_scan_events.some((c) => c.web_scan_id === x.web_scan_id && c.step === x.step)) return res(409, { code: '23505' }); }
      if (t === 'web_scan_returns') { const x = rows[0]; if (!db.web_scans.some((w) => w.id === x.web_scan_id) || !db.web_scans.some((w) => w.id === x.previous_scan_id)) return res(409, { code: '23503' }); }
      if (t === 'hexagon_scores' && rows.some((x) => db.hexagon_scores.some((h) => h.scan_id === x.scan_id && h.category === x.category))) return res(409, { code: '23505' });   // unique (scan_id, category)
      if (t === 'users' && db.users.some((u) => u.email === rows[0].email)) return res(409, 'dup');
      if (t === 'leads' && db.leads.some((u) => u.email === rows[0].email)) return res(409, 'dup');
      if (t === 'email_suppressions' && db.email_suppressions.some((u) => u.email_hash === rows[0].email_hash)) return res(409, 'dup');
      if (rows.length > 1 && new Set(rows.map((x) => Object.keys(x).filter((k) => !['id', 'report_status', 'report_attempts'].includes(k)).sort().join(','))).size > 1) return res(400, { code: 'PGRST102', message: 'All object keys must match' });   // PostgREST bulk-insert rule
      db[t].push(...rows); return res(201, rows); }
    if (o.method === 'PATCH' && t === 'web_scan_events') { const lt = Number(q.get('seconds').replace('lt.', '')); const hit = db.web_scan_events.filter((x) => x.web_scan_id === q.get('web_scan_id').replace('eq.', '') && x.step === q.get('step').replace('eq.', '') && x.seconds < lt); hit.forEach((x) => Object.assign(x, JSON.parse(o.body))); return res(200, hit); }
    if (o.method === 'PATCH' && t === 'referrals') return res(200, []);   // MPC-7645: no pre-invited rows in these tests
    if (o.method === 'PATCH') { const id = q.get('id')?.replace('eq.', ''); const st = q.get('report_status')?.replace('eq.', '');
      const fs = q.get('followup_stage')?.replace('eq.', ''); const em = q.get('email')?.replace('eq.', '');
      const cl = q.get('report_claimed_at')?.replace('lt.', ''); const ag = q.get('report_attempts');
      const hit = db[t].filter((x) => (!id || x.id === id) && (!st || x.report_status === st) && (!cl || (x.report_claimed_at && new Date(x.report_claimed_at) < new Date(cl))) && (!ag || (ag.startsWith('gte.') ? x.report_attempts >= Number(ag.slice(4)) : x.report_attempts < Number(ag.slice(3)))) && (fs === undefined || String(x.followup_stage ?? 0) === fs) && (!em || x.email === decodeURIComponent(em))); hit.forEach((x) => Object.assign(x, JSON.parse(o.body))); return res(200, hit); }
    let rows = db[t]; const uid = q.get('id')?.replace('eq.', ''); if (uid) rows = rows.filter((x) => x.id === uid);
    if (t === 'scans' && q.get('report_status') === 'eq.sent') rows = rows.filter((x) => x.report_status === 'sent' && (x.followup_stage ?? 0) < 2 && x.report_sent_at && new Date(x.report_sent_at) < new Date(decodeURIComponent(q.get('report_sent_at').replace('lt.', ''))));
    const rc = q.get('referral_code'); if (rc?.startsWith('eq.')) rows = rows.filter((x) => x.referral_code === rc.slice(3));
    const e = q.get('email')?.replace('eq.', ''); if (e && !e.startsWith('ilike.')) rows = rows.filter((x) => x.email === decodeURIComponent(e));
    if (q.get('email')?.startsWith('ilike.')) { const v = decodeURIComponent(q.get('email').slice(6)).replace(/\\(.)/g, '$1').toLowerCase(); rows = rows.filter((x) => String(x.email).toLowerCase() === v); }
    const eh = q.get('email_hash'); if (eh?.startsWith('eq.')) rows = rows.filter((x) => x.email_hash === eh.slice(3));
    const u = q.get('user_id')?.replace('eq.', ''); if (u) rows = rows.filter((x) => x.user_id === u);
    const sc = q.get('scan_id')?.replace('eq.', ''); if (sc) rows = rows.filter((x) => x.scan_id === sc);   // like PostgREST: a read by scan_id returns that scan's rows only
    if (t === 'scans' && q.get('or')) rows = rows.filter((x) => x.report_status === 'pending');
    if (t === 'scans' && (q.get('select') || '').includes('users(')) rows = rows.map((r) => ({ ...r, users: { email_opt_out_at: (db.users.find((u) => u.id === r.user_id) || {}).email_opt_out_at ?? null } }));
    if (t === 'scans' && q.get('or')) rows = rows.slice(Number(q.get('offset') || 0), Number(q.get('offset') || 0) + Number(q.get('limit') || rows.length));   // oldest first = insertion order
    return res(200, rows);
  };
  return { f, db, calls, provider: seenKeys };   // provider: Idempotency-Key -> message id, one entry per distinct email the provider accepted (resendIdempotent only)
}
