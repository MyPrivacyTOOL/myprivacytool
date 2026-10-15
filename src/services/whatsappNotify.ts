// "Deep dive complete" WhatsApp utility template. Pure builders plus one send function with an injected fetch.
// The template (name, language, three body parameters) must be approved in Meta Business Manager before the first real send.
export const TEMPLATE_NAME = 'mpt_deep_dive_ready';
export const GRAPH_VERSION = 'v21.0';
export const TEMPLATE_LANGUAGES = ['en', 'zh_HK'] as const;
export type TemplateLanguage = (typeof TEMPLATE_LANGUAGES)[number];

/** Hosts a dashboard link may point at: the template body carries this URL, so an open value would let a caller phish through our number. */
export const DASHBOARD_HOSTS = ['myprivacytool.io', 'www.myprivacytool.io'];

export interface NotifyInput { wa_id: string; verified_exposure_count: number; web_dashboard_url: string; display_name?: string | null; language?: string }

export class NotifyInputError extends Error {}

// WhatsApp rejects template parameters containing newlines, tabs or 4+ consecutive spaces.
// eslint-disable-next-line no-control-regex
const param = (s: string, max: number) => s.replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/ {2,}/g, ' ').trim().slice(0, max);

export function validateNotify(i: NotifyInput): { wa_id: string; name: string; count: number; url: string; language: TemplateLanguage } {
  if (!/^\d{6,15}$/.test(String(i.wa_id ?? ''))) throw new NotifyInputError('wa_id must be 6-15 digits');
  if (!Number.isInteger(i.verified_exposure_count) || i.verified_exposure_count < 0 || i.verified_exposure_count > 999) throw new NotifyInputError('verified_exposure_count must be an integer 0-999');
  let u: URL;
  try { u = new URL(String(i.web_dashboard_url)); } catch { throw new NotifyInputError('web_dashboard_url is not a URL'); }
  if (u.protocol !== 'https:' || !DASHBOARD_HOSTS.includes(u.hostname) || u.username || u.password) throw new NotifyInputError('web_dashboard_url must be an https myprivacytool.io link');
  const language = (i.language ?? 'en') as TemplateLanguage;
  if (!TEMPLATE_LANGUAGES.includes(language)) throw new NotifyInputError('unsupported language');
  return { wa_id: i.wa_id, name: param(i.display_name ?? '', 60) || 'there', count: i.verified_exposure_count, url: u.toString(), language };
}

export function buildTemplatePayload(i: NotifyInput) {
  const v = validateNotify(i);
  return {
    messaging_product: 'whatsapp',
    to: v.wa_id,
    type: 'template',
    template: {
      name: TEMPLATE_NAME,
      language: { code: v.language },
      components: [{ type: 'body', parameters: [v.name, String(v.count), v.url].map((text) => ({ type: 'text', text })) }],
    },
  };
}

export interface SendResult { ok: boolean; message_id: string | null; http_status: number | null; error: string | null }

/** Never throws. The Meta token goes in the Authorization header only, and is never logged or returned. */
export async function sendTemplate(
  env: { WHATSAPP_PHONE_NUMBER_ID?: string; META_WHATSAPP_KEY?: string },
  input: NotifyInput,
  fetchImpl: typeof fetch = fetch,
): Promise<SendResult> {
  if (!env.WHATSAPP_PHONE_NUMBER_ID || !env.META_WHATSAPP_KEY) return { ok: false, message_id: null, http_status: null, error: 'whatsapp_not_configured' };
  try {
    const res = await fetchImpl(`https://graph.facebook.com/${GRAPH_VERSION}/${env.WHATSAPP_PHONE_NUMBER_ID}/messages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${env.META_WHATSAPP_KEY}` },
      body: JSON.stringify(buildTemplatePayload(input)),
      signal: AbortSignal.timeout(8000),
    });
    const body: { messages?: { id?: unknown }[]; error?: { code?: unknown; message?: unknown } } = await res.json().catch(() => ({}));
    const id = body?.messages?.[0]?.id;
    if (res.ok && typeof id === 'string') return { ok: true, message_id: id, http_status: res.status, error: null };
    const e = body?.error;
    return { ok: false, message_id: null, http_status: res.status, error: `meta_${e?.code ?? res.status}: ${String(e?.message ?? 'no message id returned').slice(0, 200)}` };
  } catch (e) {
    return { ok: false, message_id: null, http_status: null, error: e instanceof NotifyInputError ? `invalid_input: ${e.message}` : 'network_error' };
  }
}
