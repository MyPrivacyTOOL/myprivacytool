import { RedditAdapter, createSnoowrapClient, type RedditClientLike } from "@/modules/channels/adapters/reddit";
import { transformRedditActivity } from "@/modules/papit/transformers/reddit";

/**
 * GET /api/channels/reddit/behavior
 * Framework-agnostic (Web Request/Response) so it runs under Next.js route
 * handlers, a Node server on DigitalOcean/Coolify, or a Worker.
 */
export interface BehaviorRouteDeps {
  /** Resolve the authenticated user id from the session; null = unauthenticated. */
  getUserId(req: Request): Promise<string | null>;
  /** Build a Reddit client from the user's decrypted tokens; null = not connected. */
  getClient(userId: string): Promise<RedditClientLike | null>;
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });

export function createBehaviorHandler(deps: BehaviorRouteDeps) {
  return async function GET(req: Request): Promise<Response> {
    const userId = await deps.getUserId(req);
    if (!userId) return json({ error: "unauthenticated" }, 401);
    const client = await deps.getClient(userId);
    if (!client) return json({ error: "reddit_not_connected" }, 404);
    try {
      const activity = await new RedditAdapter(client).fetchActivity();
      return json(transformRedditActivity(activity));
    } catch {
      return json({ error: "reddit_fetch_failed" }, 502); // never echo upstream details
    }
  };
}

/** Default export is unwired until the host app supplies session + token deps. */
export const GET = createBehaviorHandler({
  getUserId: async () => null,
  getClient: async () => null,
});
export { createSnoowrapClient };
