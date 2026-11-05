import { getCloudflareContext } from "@opennextjs/cloudflare";
import { brandDefaults, getBrand, type Brand } from "./brand.ts";
import { reportError } from "./errors.ts";

/** Bindings, vars and secrets. Secrets are set in the Cloudflare dashboard, never in code. */
export type AppEnv = CloudflareEnv & {
  ADMIN_PASS?: string;
  /** GitHub token with only Actions read and write on this repo (starts agent runs). */
  GITHUB_TOKEN?: string;
  /** Shared with the GitHub secret of the same name; signs agent requests. */
  AGENT_SECRET?: string;
  GITHUB_REPO?: string;
  AGENT_WORKFLOW?: string;
  AGENT_REF?: string;
};

/** Cloudflare bindings and vars (D1, R2, settings). Server only. */
export async function getEnv(): Promise<AppEnv> {
  const { env } = await getCloudflareContext({ async: true });
  return env as AppEnv;
}

/** The APP_NAME var: used only when the brand settings have no name yet. */
export async function fallbackName(): Promise<string> {
  const env = await getEnv();
  return env.APP_NAME || "Exam Prep";
}

/** Brand settings from /admin/brand (brief 15.3: never hardcoded). A database problem falls back to the defaults. */
export async function currentBrand(): Promise<Brand> {
  const env = await getEnv();
  const name = env.APP_NAME || "Exam Prep";
  try {
    return await getBrand(env.DB, name);
  } catch (err) {
    reportError("brand.read", err);
    return brandDefaults(name);
  }
}

/** The platform name, as set on the Brand page. */
export async function appName(): Promise<string> {
  return (await currentBrand()).name;
}
