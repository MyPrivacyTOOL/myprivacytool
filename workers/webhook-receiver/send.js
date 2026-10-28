// CK-8503 (G7): the channel senders used to fire a request and ignore the answer, so a refused or failed send looked exactly like a delivered
// one. This records the outcome (label and HTTP status only: never the URL, which can hold a token, and never the message) and returns it.
// A provider "ok" still only means the provider accepted the message; none of these APIs tells us it reached the person.
export async function sendJson(label, url, headers, body, fetchImpl = fetch) {
  try {
    const res = await fetchImpl(url, { method: 'POST', headers, body: JSON.stringify(body) });
    if (!res.ok) console.error(`send_failed channel=${label} status=${res.status}`);
    return { ok: Boolean(res.ok), status: res.status };
  } catch (e) {
    console.error(`send_failed channel=${label} error=${e?.name || 'error'}`);
    return { ok: false, status: 0 };
  }
}
