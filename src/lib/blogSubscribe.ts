import { recipientFetch } from "@/lib/recipientClient";

// MPC-10616: the /blog newsletter form posts to the existing mpt-leads Worker (POST /blog-subscribe), which creates or updates the HubSpot
// contact (portal 246502821) with blog_source=true and the page path. A repeat submit updates the same contact.
export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export async function subscribeToBlogNewsletter(email: string, path: string): Promise<void> {
  const base = (import.meta.env.VITE_WORKER_ENDPOINT || "https://api.myprivacytool.io").replace(/\/+$/, "");
  let res: Response;
  try {
    res = await recipientFetch("leads", `${base}/blog-subscribe`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, path, consent: true }),
    }, ["email"]);
  } catch {
    throw new Error("We could not reach the server. Please try again in a moment.");
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data?.success) {
    throw new Error(res.status === 400 && data?.message ? String(data.message) : "We could not save your subscription. Please try again, or email hello@myprivacytool.io.");
  }
}
