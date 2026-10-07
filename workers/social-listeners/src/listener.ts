import type { Logger } from "@mpt/utils";
import type { Env } from "./env";

/** One platform = one Listener. `id` becomes the route: /listen/<id>. */
export interface Listener {
  id: string;
  platform: string;
  handle(request: Request, env: Env, log: Logger): Promise<Response>;
}
