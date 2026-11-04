#!/usr/bin/env node
// MPC-7488: operator tool for saved web scans (tables web_scans and web_scan_contacts). Service-role only, run by an operator.
//
//   SUPABASE_URL=https://<project>.supabase.co SUPABASE_SERVICE_ROLE_KEY=... node scripts/web-scan-admin.mjs <command>
//
//   delete <scan-number>     delete the saved scan and its contact link(s). Use when a visitor quotes their scan number.
//   export <scan-number>     print the saved scan stored under that number (access request)
//   purge [--dry-run]        run the retention clean-up now (it also runs daily in the database); --dry-run only counts
//
// Output is counts only. The scan number is never echoed back or logged, and nothing personal is written to the deletion log
// (public.web_scan_deletion_log holds kind, counts and time). Exit code 0 = done, 1 = failed, 2 = bad usage, 3 = number not found.
import { pathToFileURL } from 'node:url';

export const SCAN_NUMBER_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

async function rpc(env, fetchImpl, fn, args) {
  const base = String(env.SUPABASE_URL || '').replace(/\/$/, '');
  if (!base || !env.SUPABASE_SERVICE_ROLE_KEY) throw new Error('Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY');
  const res = await fetchImpl(`${base}/rest/v1/rpc/${fn}`, {
    method: 'POST',
    headers: { apikey: env.SUPABASE_SERVICE_ROLE_KEY, Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(args),
  });
  if (!res.ok) throw new Error(`database call ${fn} failed with HTTP ${res.status}`);   // never include the body or the arguments
  return res.json();
}

/** Runs one command. Returns { code, out } where out is a list of lines to print. Pure apart from the injected fetch. */
export async function run(argv, env = process.env, fetchImpl = fetch) {
  const [cmd, ...rest] = argv;
  const flags = new Set(rest.filter((a) => a.startsWith('--')));
  const pos = rest.filter((a) => !a.startsWith('--'));
  try {
    if (cmd === 'delete' || cmd === 'export') {
      const n = pos[0];
      if (!n || pos.length !== 1 || !SCAN_NUMBER_RE.test(n)) return { code: 2, out: [`usage: web-scan-admin ${cmd} <scan-number>   (a scan number looks like 8-4-4-4-12 hex digits)`] };
      if (cmd === 'export') {
        const r = await rpc(env, fetchImpl, 'mpt_export_web_scan', { p_scan_number: n.toLowerCase() });
        return { code: r?.web_scan ? 0 : 3, out: [JSON.stringify(r, null, 2)] };
      }
      const r = await rpc(env, fetchImpl, 'mpt_delete_web_scan', { p_scan_number: n.toLowerCase() });
      return r?.found
        ? { code: 0, out: [`deleted: ${r.scans_deleted} scan, ${r.contact_links_deleted} contact link(s) at ${r.deleted_at}`] }
        : { code: 3, out: ['no saved scan under that number (nothing deleted)'] };
    }
    if (cmd === 'purge') {
      const dry = flags.has('--dry-run');
      const r = await rpc(env, fetchImpl, 'mpt_purge_expired_web_scans', { p_dry_run: dry });
      return { code: 0, out: [`${dry ? 'DRY RUN, nothing deleted. Would delete' : 'deleted'}: ${r.scans} scan(s) (${r.unlinked_scans} never linked to a contact, ${r.expired_scans} older than ${r.months} months), ${r.contact_links} contact link(s)`] };
    }
    return { code: 2, out: ['usage: web-scan-admin delete <scan-number> | export <scan-number> | purge [--dry-run]'] };
  } catch (e) {
    return { code: 1, out: [String(e.message || e).replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f-]{23}/gi, '[scan number]')] };
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  run(process.argv.slice(2)).then(({ code, out }) => { for (const l of out) console.log(l); process.exit(code); });
}
