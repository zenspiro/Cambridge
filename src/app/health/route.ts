import { getEnv } from "@/lib/env";
import { newErrorRef, reportError } from "@/lib/errors";

// Public by design (access: public). Shows only pass or fail per check, never details.
export const dynamic = "force-dynamic";

async function check(name: string, fn: () => Promise<unknown>, ref: string): Promise<boolean> {
  try {
    await fn();
    return true;
  } catch (err) {
    reportError(`health.${name}`, err, ref);
    return false;
  }
}

export async function GET() {
  const ref = newErrorRef();
  const env = await getEnv();
  const [database, files, source] = await Promise.all([
    check("database", () => env.DB.prepare("SELECT 1 AS ok").first(), ref),
    check("files", () => env.FILES.head("health/ping"), ref),
    check("source", () => env.SOURCE.head("health/ping"), ref),
  ]);
  const ok = database && files && source;
  return Response.json(
    { ok, checks: { database, files, source }, ...(ok ? {} : { ref }) },
    { status: ok ? 200 : 503, headers: { "Cache-Control": "no-store" } },
  );
}
