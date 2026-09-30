// Minimal client for the HubSpot Forms API (public, unauthenticated submit endpoint).
// Portal 246502821 (na2) — same portal as the newsletter embed on the home page.

export const HUBSPOT_PORTAL_ID = "246502821";

export interface HubSpotSubmitOptions {
  formId: string;
  fields: Record<string, string>;
  pageName?: string;
}

interface HubSpotCookieWindow {
  hubspotutk?: string;
}

const readHubspotUtk = (): string | undefined => {
  const match = document.cookie.match(/(?:^|;\s*)hubspotutk=([^;]+)/);
  return match ? decodeURIComponent(match[1]) : (window as unknown as HubSpotCookieWindow).hubspotutk;
};

export async function submitHubSpotForm({ formId, fields, pageName }: HubSpotSubmitOptions): Promise<void> {
  const res = await fetch(
    `https://api.hsforms.com/submissions/v3/integration/submit/${HUBSPOT_PORTAL_ID}/${formId}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        fields: Object.entries(fields).map(([name, value]) => ({ name, value })),
        context: {
          hutk: readHubspotUtk(),
          pageUri: window.location.href,
          pageName: pageName ?? document.title,
        },
      }),
    }
  );
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data?.message || `HubSpot error ${res.status}`);
  }
}
