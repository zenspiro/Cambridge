import { getCloudflareContext } from "@opennextjs/cloudflare";

/** Cloudflare bindings and vars (D1, R2, settings). Server only. */
export async function getEnv(): Promise<CloudflareEnv> {
  const { env } = await getCloudflareContext({ async: true });
  return env;
}

/** Brand name comes from config (brief 15.3), never hardcoded. */
export async function appName(): Promise<string> {
  const env = await getEnv();
  return env.APP_NAME || "Exam Prep";
}
