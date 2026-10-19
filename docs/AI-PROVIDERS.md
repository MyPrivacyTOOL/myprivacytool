# AI model providers: one rule, any provider

**Policy (Chris, 2026-10-14):** MyPrivacyTOOL keeps the ability to use an AI model from **any provider, open-source or closed-source, from any country**, chosen for the business and technical need. We do not tie the product, the Privacy Policy or the DPA to one named model.

## How the code stays flexible
- Each Worker that calls a model reads its provider settings from environment variables (today `core-brain`: `QWEN_API_KEY`, `QWEN_BASE_URL`, `QWEN_MODEL`, an OpenAI-compatible chat endpoint). Switching provider or model is a configuration change plus the checklist below, not a code change, as long as the provider offers a compatible endpoint.
- Every model call sends the minimum: for `core-brain` that is the message text with emails and phone numbers stripped (`redact()`), never names, contact details or scan results added by us.
- Without a key, `core-brain` falls back to its rules classifier, so a provider can be switched off without breaking the product.

## Before ANY new or changed provider or model receives personal data
1. Add or update the provider in the sub-processor list (`SUB_PROCESSORS` in `src/pages/DPA.tsx`). Say what it receives and why.
2. The generic wording in Privacy Policy section 5 ("AI Model Providers") already covers any provider; check it is still true (what is sent, redaction, countries). Change it only if the facts changed.
3. Record, on the task: the provider's data-retention and training-on-customer-data terms, and the countries where it processes data. Get legal review (MPC-6798) if the answer is not clearly acceptable.
4. Only then set the secret and variables in production.

The pull request template has a tick-box that points here.
