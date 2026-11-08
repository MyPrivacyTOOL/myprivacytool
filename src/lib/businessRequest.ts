// MPC-9825: queues a /business form submission for the staffed 48-hour results service (mpt-leads Worker, POST /business-request).
// A request that is not queued is NOT acknowledged: the caller shows an error instead of promising a 48-hour clock that nothing is running.
export interface BusinessRequestInput {
  name: string;
  email: string;
  company: string;
  size: string;
  consent: boolean;
  consentSource: string;
}
export interface BusinessRequestResult {
  ref: string;
  dueAt: string;
}

export async function queueBusinessRequest(input: BusinessRequestInput): Promise<BusinessRequestResult> {
  const base = (import.meta.env.VITE_WORKER_ENDPOINT || "https://api.myprivacytool.io").replace(/\/+$/, "");
  let res: Response;
  try {
    res = await fetch(`${base}/business-request`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: input.name,
        email: input.email,
        company: input.company,
        size: input.size,
        consent: input.consent,
        consent_source: input.consentSource,
      }),
    });
  } catch {
    throw new Error("We could not send your request. Please try again, or email hello@myprivacytool.io.");
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data?.success || typeof data.ref !== "string") {
    throw new Error("We could not record your request, so no 48-hour timer has started. Please try again, or email hello@myprivacytool.io.");
  }
  return { ref: data.ref, dueAt: String(data.due_at || "") };
}
