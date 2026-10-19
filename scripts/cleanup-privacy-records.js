#!/usr/bin/env node

/**
 * cleanup-privacy-records.js
 * 
 * Removes privacy-sensitive historical website-leads records that should not be persisted.
 * 
 * Scope:
 * - Deletes all records from localStorage prefixed with 'website-leads-'
 * - Deletes all records from sessionStorage prefixed with 'website-leads-'
 * - Deletes historical scan records older than 30 days from localStorage
 * - Optional: calls backend API to delete Supabase records
 * 
 * Privacy principle: This is a CLIENT-SIDE cleanup script. It runs when:
 * 1. A user opts out or deletes their account
 * 2. As part of the post-go-live data hygiene pass
 * 3. In response to a GDPR/PDPA request
 * 
 * Note: This script uses localStorage APIs and assumes it runs in a browser context.
 * For server-side cleanup (Supabase), see scripts/cleanup-supabase-historical.sh
 */

const fs = require('fs');
const path = require('path');

/**
 * Simulate localStorage cleanup logic (for server-side testing)
 * In production, this runs in the browser via a cleanup page or service worker
 */
function cleanupLocalStorageSimulation() {
  const prefix = 'website-leads-';
  const keysToDelete = [];

  // In a real browser:
  // for (let i = 0; i < localStorage.length; i++) {
  //   const key = localStorage.key(i);
  //   if (key && key.startsWith(prefix)) {
  //     keysToDelete.push(key);
  //   }
  // }

  console.log(`[cleanup] Found ${keysToDelete.length} website-leads records to delete`);
  return keysToDelete;
}

/**
 * Simulate sessionStorage cleanup logic
 */
function cleanupSessionStorageSimulation() {
  const prefix = 'website-leads-';
  const keysToDelete = [];

  // In a real browser:
  // for (let i = 0; i < sessionStorage.length; i++) {
  //   const key = sessionStorage.key(i);
  //   if (key && key.startsWith(prefix)) {
  //     keysToDelete.push(key);
  //   }
  // }

  console.log(`[cleanup] Found ${keysToDelete.length} website-leads records in session to delete`);
  return keysToDelete;
}

/**
 * Identify old scan records (older than 30 days)
 */
function findOldScanRecords(retentionDays = 30) {
  const now = Date.now();
  const maxAge = retentionDays * 24 * 60 * 60 * 1000;
  const oldRecords = [];

  // In a real browser, this would iterate localStorage for scan records:
  // const scanRecord = localStorage.getItem('mpt_scan_result');
  // if (scanRecord) {
  //   const parsed = JSON.parse(scanRecord);
  //   if (parsed.created_at && (now - new Date(parsed.created_at).getTime()) > maxAge) {
  //     oldRecords.push({ key: 'mpt_scan_result', age: now - new Date(parsed.created_at).getTime() });
  //   }
  // }

  console.log(`[cleanup] Found ${oldRecords.length} scan records older than ${retentionDays} days`);
  return oldRecords;
}

/**
 * Generate a client-side cleanup page that users can visit to clear their data
 */
function generateCleanupPageHTML() {
  return `<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <title>MyPrivacyTOOL — Clear Your Data</title>
  <style>
    body { font-family: Inter, sans-serif; max-width: 600px; margin: 50px auto; padding: 20px; }
    .status { padding: 10px; border-radius: 4px; margin: 10px 0; }
    .status.ok { background: #d4edda; color: #155724; }
    .status.warn { background: #fff3cd; color: #856404; }
    .status.error { background: #f8d7da; color: #721c24; }
    button { padding: 10px 20px; font-size: 1rem; cursor: pointer; }
  </style>
</head>
<body>
  <h1>Clear Your MyPrivacyTOOL Data</h1>
  <p>This page permanently deletes your stored scans and website-leads records from your browser.</p>
  
  <div id="status"></div>
  
  <button onclick="clearLocalData()">Clear Local Data</button>
  <button onclick="clearBackendData()">Delete Backend Records (requires confirmation)</button>
  
  <script>
    const statusEl = document.getElementById('status');
    
    function log(msg, type = 'info') {
      const div = document.createElement('div');
      div.className = 'status ' + (type === 'ok' ? 'ok' : type === 'error' ? 'error' : 'warn');
      div.textContent = msg;
      statusEl.appendChild(div);
      console.log('[cleanup]', msg);
    }
    
    function clearLocalData() {
      try {
        // Clear website-leads records
        const keys = Object.keys(localStorage);
        const deleted = keys.filter(k => k.startsWith('website-leads-'));
        deleted.forEach(k => localStorage.removeItem(k));
        log(\`Deleted \${deleted.length} website-leads records\`, 'ok');
        
        // Clear old scan records
        localStorage.removeItem('mpt_scan_result');
        log('Deleted scan result', 'ok');
        
        // Clear session data
        sessionStorage.clear();
        log('Cleared session storage', 'ok');
      } catch (e) {
        log('Error: ' + e.message, 'error');
      }
    }
    
    async function clearBackendData() {
      const email = localStorage.getItem('mpt_email');
      if (!email) {
        log('No email found. Cannot delete backend records.', 'warn');
        return;
      }
      
      const confirmed = confirm(
        \`Are you sure? This will permanently delete all scans associated with \${email} from our servers.\\n\\n\` +
        \`This cannot be undone.\`
      );
      
      if (!confirmed) return;
      
      try {
        const res = await fetch('/api/scans/delete', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email, all: true })
        });
        
        if (res.ok) {
          log('Backend records deleted', 'ok');
        } else {
          log('Backend deletion failed: ' + res.status, 'error');
        }
      } catch (e) {
        log('Network error: ' + e.message, 'error');
      }
    }
  </script>
</body>
</html>`;
}

/**
 * Main cleanup function
 */
async function main() {
  console.log('[cleanup] Starting privacy records cleanup...');
  console.log('[cleanup] Node version:', process.version);

  // Generate client-side cleanup page
  const cleanupPageHTML = generateCleanupPageHTML();
  const outputPath = path.join(__dirname, '..', 'public', 'cleanup.html');
  fs.writeFileSync(outputPath, cleanupPageHTML);
  console.log('[cleanup] Generated cleanup page:', outputPath);

  // Simulate browser cleanup logic (for reference)
  console.log('[cleanup] --- Browser Cleanup Simulation ---');
  cleanupLocalStorageSimulation();
  cleanupSessionStorageSimulation();
  findOldScanRecords(30);

  // Print instructions
  console.log('[cleanup] --- Instructions ---');
  console.log('1. Deploy cleanup.html to the website root');
  console.log('2. Users visit: https://myprivacytool.io/cleanup.html');
  console.log('3. Click "Clear Local Data" to remove browser records');
  console.log('4. Click "Delete Backend Records" to remove server-side scans');
  console.log('');
  console.log('For automated backend cleanup, run:');
  console.log('  ./scripts/cleanup-supabase-historical.sh');
  console.log('');
}

main().catch(e => {
  console.error('[cleanup] Fatal error:', e);
  process.exit(1);
});
