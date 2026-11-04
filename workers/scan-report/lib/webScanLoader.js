// Loads the user's saved web scan (MPC-7465, tables web_scans and web_scan_contacts). Returns null when there is none, so the report
// still sends with Part 1 explained honestly. Never throws.
// web_scan_contacts links a saved scan to the report request: channel 'email', contact_id = scans.id.
export async function loadWebScan(sb, scanId) {
  try {
    const link = (await sb.select(`web_scan_contacts?channel=eq.email&contact_id=eq.${encodeURIComponent(scanId)}&select=web_scan_id&order=linked_at.desc&limit=1`))?.[0];
    if (!link?.web_scan_id) return null;
    const row = (await sb.select(`web_scans?id=eq.${encodeURIComponent(link.web_scan_id)}&select=id,created_at,results&limit=1`))?.[0];
    return row && Array.isArray(row.results) ? { id: row.id, created_at: row.created_at, hexagons: row.results } : null;
  } catch (e) {
    console.warn('no saved web scan loaded:', String(e).replace(/\S+@\S+/g, '[email]').slice(0, 120));
    return null;
  }
}
