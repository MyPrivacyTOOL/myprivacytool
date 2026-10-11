// Loads the user's saved web scan (MPC-7465). Returns null when there is none, so the report still sends with Part 1 explained honestly.
// ASSUMED SHAPE until MPC-7465 merges (adjust here only): table web_scans { id, created_at, linked_scan_id, results }, where results is the
// array of hexagon items { id, status, value?, estimate?, detail? } (or an object with that array under `hexagons`).
export async function loadWebScan(sb, scanId) {
  try {
    const row = (await sb.select(`web_scans?linked_scan_id=eq.${encodeURIComponent(scanId)}&select=id,created_at,results&limit=1`))?.[0];
    const list = Array.isArray(row?.results) ? row.results : row?.results?.hexagons;
    return row && Array.isArray(list) ? { id: row.id, created_at: row.created_at, hexagons: list } : null;
  } catch (e) {
    console.warn('no saved web scan loaded:', String(e).replace(/\S+@\S+/g, '[email]').slice(0, 120));
    return null;
  }
}
