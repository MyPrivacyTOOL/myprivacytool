// MPC-9783: the one place triage talks to the model (Qwen through an OpenAI-compatible endpoint, as core-brain does). Settings come from `env`: QWEN_API_KEY (secret), QWEN_BASE_URL, QWEN_MODEL.
// The request carries the instructions and the quoted message ONLY: no tools, no functions, nothing the model could act with. A slow or failed call throws; the caller treats that as "send to a person".
import { callRecipient } from '../recipients/outbound.ts';
import { workerRecipientContext } from '../recipients/worker-ctx.ts';

const DEFAULT_BASE = 'https://dashscope-intl.aliyuncs.com/compatible-mode/v1';
export const QWEN_TIMEOUT_MS = 8000;

/** @returns {(system: string, user: string) => Promise<string>} */
export function makeAsk(env, fetchImpl = undefined, timeoutMs = QWEN_TIMEOUT_MS, rctx) {
  if (!env?.QWEN_API_KEY) throw new Error('QWEN_API_KEY is not set');
  const base = (env.QWEN_BASE_URL || DEFAULT_BASE).replace(/\/$/, '');
  const model = env.QWEN_MODEL || 'qwen-plus';
  const ctx = rctx ?? workerRecipientContext(env, { fetchImpl });
  return async (system, user) => {
    const ctl = new AbortController(); const timer = setTimeout(() => ctl.abort(), timeoutMs);
    try {
      // MPC-9885: the quoted message (emails and phones masked before this point) is the only visitor content sent.
      const res = await callRecipient('dashscope', {
        url: `${base}/chat/completions`, sent: ['message_text'],
        init: {
          method: 'POST', signal: ctl.signal, headers: { 'content-type': 'application/json', authorization: `Bearer ${env.QWEN_API_KEY}` },
          body: JSON.stringify({ model, temperature: 0, messages: [{ role: 'system', content: system }, { role: 'user', content: user }] }),
        },
      }, ctx);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return (await res.json())?.choices?.[0]?.message?.content ?? '';
    } finally { clearTimeout(timer); }
  };
}
