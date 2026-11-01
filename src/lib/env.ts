import { getCloudflareContext } from "@opennextjs/cloudflare";

/** Bindings, vars and secrets. Secrets are set in the Cloudflare dashboard, never in code. */
export type AppEnv = CloudflareEnv & { ADMIN_PASS?: string };

/** Cloudflare bindings and vars (D1, R2, settings). Server only. */
export async function getEnv(): Promise<AppEnv> {
  const { env } = await getCloudflareContext({ async: true });
  return env as AppEnv;
}

/** Brand name comes from config (brief 15.3), never hardcoded. */
export async function appName(): Promise<string> {
  const env = await getEnv();
  return env.APP_NAME || "Exam Prep";
}
