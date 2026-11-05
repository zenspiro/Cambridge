import { accountSession } from "@/lib/account/server";
import { isMyChild } from "@/lib/account/family";
import { exportAccount } from "@/lib/account/profile";
import { getEnv } from "@/lib/env";
import { audit } from "@/lib/auth/session";
import { reportError } from "@/lib/errors";

/** A child's data, for their parent (only a child in the parent's own family). */
export async function GET(request: Request) {
  const s = await accountSession();
  if (!s) return new Response("Sign in first", { status: 401 });
  const child = new URL(request.url).searchParams.get("child") ?? "";
  try {
    const db = (await getEnv()).DB;
    if (!(await isMyChild(db, s.userId, child))) return new Response("Not found", { status: 404 });
    const data = await exportAccount(db, child);
    await audit(db, { actorId: s.userId, action: "account.export_by_parent", entity: "account", entityId: child });
    return new Response(JSON.stringify(data, null, 2), {
      headers: {
        "Content-Type": "application/json",
        "Content-Disposition": 'attachment; filename="child-data.json"',
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (err) {
    return new Response(`Something went wrong. Reference: ${reportError("family.export", err)}`, { status: 500 });
  }
}
