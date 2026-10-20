#!/usr/bin/env node
/**
 * sync-workstream-3-to-kv.mjs
 * 
 * Reads MyPrivacyTOOL's Notion WORKSTREAM 3 database and syncs daily topic
 * assignments to Cloudflare KV namespace mpt-brand-topics.
 * 
 * Runs daily at 22:00 HKT (via Cloudflare scheduled trigger or manual invocation).
 * Idempotent: overwrites keys for dates already present.
 * 
 * Usage:
 *   npm run sync:workstream-3-to-kv
 * 
 * Environment:
 *   NOTION_TOKEN: Notion integration token (required)
 *   CLOUDFLARE_API_TOKEN: Cloudflare API token with KV:write (required)
 *   CF_ACCOUNT_ID: Cloudflare account ID (default: 35cb17172c65a20f5cf1baf131485382)
 *   KV_NAMESPACE_ID: KV namespace ID for mpt-brand-topics (default: from wrangler.toml)
 */

import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const NOTION_TOKEN = process.env.NOTION_TOKEN || '';
const CLOUDFLARE_API_TOKEN = process.env.CLOUDFLARE_API_TOKEN || '';
const CF_ACCOUNT_ID = process.env.CF_ACCOUNT_ID || '35cb17172c65a20f5cf1baf131485382';
const KV_NAMESPACE_ID = process.env.KV_NAMESPACE_ID || '85e2c0b18f4d4e1e892a37c8d6f5a1b9'; // TBD: fetch from wrangler.toml

// === NOTION FETCH ===
async function fetchWorkstream3(notionToken) {
  const databaseId = 'WORKSTREAM_3_DATABASE_ID'; // TBD: Chris provides Notion database ID
  if (!notionToken) throw new Error('NOTION_TOKEN not set');

  const response = await fetch(`https://api.notion.com/v1/databases/${databaseId}/query`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${notionToken}`,
      'Notion-Version': '2022-06-28',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      filter: {
        and: [
          { property: 'Status', select: { equals: 'Ready' } },
          { property: 'Date', date: { on_or_after: new Date().toISOString().slice(0, 10) } },
        ],
      },
      sorts: [{ property: 'Date', direction: 'ascending' }],
      page_size: 100,
    }),
  });

  if (!response.ok) {
    throw new Error(`Notion API error: ${response.status} ${response.statusText}`);
  }

  const data = await response.json();
  return data.results.map((result) => {
    const props = result.properties;
    return {
      date: props.Date?.date?.start || '',
      topic: props.Topic?.title?.[0]?.plain_text || '',
      pillar: props.Pillar?.select?.name || 'awareness', // default
      format_type: props.Format?.select?.name || 'mixed', // default
      asset_tags: props.Tags?.multi_select?.map((t) => t.name) || [],
      notionPageId: result.id,
    };
  });
}

// === KV WRITE ===
async function writeToKV(topics, cfToken, accountId, kvId) {
  if (!cfToken) throw new Error('CLOUDFLARE_API_TOKEN not set');
  const baseUrl = `https://api.cloudflare.com/client/v4/accounts/${accountId}/storage/kv/namespaces/${kvId}/values`;

  for (const topic of topics) {
    const key = topic.date; // e.g., "2026-10-20"
    const value = JSON.stringify({
      date: topic.date,
      topic: topic.topic,
      pillar: topic.pillar,
      format_type: topic.format_type,
      asset_tags: topic.asset_tags,
      notionPageId: topic.notionPageId,
      syncedAt: new Date().toISOString(),
    });

    const response = await fetch(`${baseUrl}/${encodeURIComponent(key)}`, {
      method: 'PUT',
      headers: {
        'Authorization': `Bearer ${cfToken}`,
        'Content-Type': 'application/json',
      },
      body: value,
    });

    if (!response.ok) {
      console.error(`Failed to write key ${key}:`, response.status, await response.text());
      throw new Error(`KV write failed for ${key}`);
    }
    console.log(`✓ Synced ${key}: "${topic.topic}"`);
  }
}

// === MAIN ===
async function main() {
  try {
    console.log('📡 Fetching WORKSTREAM 3 from Notion...');
    const topics = await fetchWorkstream3(NOTION_TOKEN);
    console.log(`✓ Found ${topics.length} topics`);

    if (topics.length === 0) {
      console.log('No ready topics to sync. Exiting.');
      process.exit(0);
    }

    console.log('📝 Writing to Cloudflare KV (mpt-brand-topics)...');
    await writeToKV(topics, CLOUDFLARE_API_TOKEN, CF_ACCOUNT_ID, KV_NAMESPACE_ID);

    console.log(`✅ Sync complete: ${topics.length} topics written to KV`);
    process.exit(0);
  } catch (err) {
    console.error('❌ Sync failed:', err.message);
    process.exit(1);
  }
}

main();
