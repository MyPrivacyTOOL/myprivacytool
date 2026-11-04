#!/usr/bin/env node
// MPC-7651: make a partner API key. Prints the key ONCE (give it to the partner over a secure channel, never commit or paste it in chat)
// and the SQL that stores only its SHA-256. Run the SQL in the Supabase SQL editor.
//   node workers/partner-api/scripts/issue-key.mjs <partner_uuid> "label"
import { createHash, randomBytes } from 'node:crypto';

const [partnerId, label = ''] = process.argv.slice(2);
if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(partnerId || '')) {
  console.error('usage: issue-key.mjs <partner_uuid> [label]'); process.exit(1);
}
const key = `mpt_live_${randomBytes(32).toString('base64url')}`;
const hash = createHash('sha256').update(key).digest('hex');
const esc = (s) => s.replace(/'/g, "''");
console.log(`API key (shown once): ${key}\n`);
console.log(`insert into public.partner_api_keys (partner_id, key_hash, key_prefix, label)\nvalues ('${partnerId}', '${hash}', '${key.slice(0, 12)}', '${esc(label)}');`);
