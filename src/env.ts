/**
 * env.ts — Worker bindings.
 *
 * KV holds the editable configuration; the two secrets are set via
 * `wrangler secret put` (or .dev.vars locally). DEFAULT_API_URL is a plain var
 * from wrangler.toml used as the initial Visibuild API base URL.
 */
export interface Env {
  CONFIG: KVNamespace;
  ADMIN_PASSWORD: string;
  SESSION_SECRET: string;
  DEFAULT_API_URL?: string;
}
