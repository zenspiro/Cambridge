import { accountSession } from "@/lib/account/server";
import { exportAccount } from "@/lib/account/profile";
import { getEnv } from "@/lib/env";
import { audit } from "@/lib/auth/session";
import { reportError } from "@/lib/errors";

/** "Download my data": everything we hold about the signed-in person, as a JSON file. */
export async function GET() {
  const s = await accountSession();
  if (!s) return new Response("Sign in first", { status: 401 });
  try {
    const db = (await getEnv()).DB;
    const data = await exportAccount(db, s.userId);
    await audit(db, { actorId: s.userId, action: "account.export", entity: "account", entityId: s.userId });
    return new Response(JSON.stringify(data, null, 2), {
      headers: {
        "Content-Type": "application/json",
        "Content-Disposition": 'attachment; filename="my-data.json"',
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (err) {
    return new Response(`Something went wrong. Reference: ${reportError("account.export", err)}`, { status: 500 });
  }
}
