import { staffForDoc } from "@/lib/auth/staff";
import { audit } from "@/lib/auth/session";
import { getEnv } from "@/lib/env";
import { redirectTo } from "@/lib/http";
import { GET_DOCUMENT } from "@/lib/library/queries";

// Admin-only download of one source file (brief 3.1, 3.2). Always an attachment,
// never shown inline, never cached, and every download is audited.
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[A-Za-z0-9_-]{10,64}$/.test(id)) return new Response("Not found", { status: 404 });
  // The owner, or a team member who may view this file's subject (library or source review).
  const access = await staffForDoc(id);
  if (!access) return redirectTo(request, "/admin/login");
  const session = access.staff;

  const env = await getEnv();
  const doc = await env.DB.prepare(GET_DOCUMENT).bind(id).first<{ id: string; file_name: string; r2_key: string }>();
  const obj = doc ? await env.SOURCE.get(doc.r2_key) : null;
  if (!doc || !obj) return new Response("Not found", { status: 404 });

  await audit(env.DB, { actorId: session.actorId, action: "source.download", entity: "source_document", entityId: doc.id });
  // file_name passed the Cambridge name pattern on the way in: lowercase letters, digits, _ and .pdf only.
  return new Response(obj.body, {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${doc.file_name}"`,
      "Content-Length": String(obj.size),
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
