/**
 * Scan Reveal Router Worker
 * ==========================
 * Routes /api/scan* requests to either:
 * - Batch 1 OSINT reveal flow (new, variant A)
 * - Legacy reveal flow (variant B or kill switch enabled)
 * 
 * Assignment is sticky per email, no cookies/fingerprinting.
 * Variant recorded in analytics with no PII.
 */

import { assignVariant, getKillSwitch, recordVariantEvent, getVariantCookieHeader } from '../lib/ab-testing.js';

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    // Only intercept POST /api/scan (the email submission endpoint)
    if (request.method !== 'POST' || !url.pathname.startsWith('/api/scan')) {
      return env.NEXT_PUBLIC_FORWARD_TO_PAGES(request);
    }

    try {
      // Parse request body to extract email
      const contentType = request.headers.get('content-type') || '';
      let email = null;

      if (contentType.includes('application/json')) {
        const json = await request.json();
        email = json.email || json.user_email;
      } else if (contentType.includes('application/x-www-form-urlencoded')) {
        const formData = await request.formData();
        email = formData.get('email') || formData.get('user_email');
      }

      if (!email) {
        // No email in request; pass through to legacy (safety fallback)
        return env.NEXT_PUBLIC_FORWARD_TO_PAGES(request);
      }

      // Check kill switch
      const mode = await getKillSwitch(env.DB);
      let variant = mode === 'legacy' ? 'B' : await assignVariant(email, env.AB_TEST_SALT);

      // Generate analytics client ID (can be from Turnstile token or random)
      // This is safe to send to GA4 because it's not PII
      const clientId = request.headers.get('x-turnstile-client-id') || crypto.randomUUID();

      // Record variant in analytics (fire-and-forget)
      ctx.waitUntil(
        recordVariantEvent(variant, env.GA4_PROPERTY_ID, clientId)
      );

      // Clone the request so we can add the variant header
      const modifiedRequest = new Request(request, {
        headers: new Headers(request.headers),
      });

      // Add variant header for downstream processing
      modifiedRequest.headers.set('x-ab-variant', variant);

      // Add variant to response cookies (optional, for debugging/tracing)
      const response = await env.NEXT_PUBLIC_FORWARD_TO_PAGES(modifiedRequest);
      const newHeaders = new Headers(response.headers);
      newHeaders.append('Set-Cookie', getVariantCookieHeader(variant));

      return new Response(response.body, {
        status: response.status,
        statusText: response.statusText,
        headers: newHeaders,
      });
    } catch (error) {
      console.error('scan-reveal-router error:', error);
      // On error, pass through to legacy (fail-safe)
      return env.NEXT_PUBLIC_FORWARD_TO_PAGES(request);
    }
  },
};
