import { adminSession } from "@/lib/auth/guard";
import { LIBRARY } from "@/lib/config";
import { getEnv } from "@/lib/env";
import { newErrorRef, reportError } from "@/lib/errors";
import { isSameOrigin, redirectTo } from "@/lib/http";
import { createJob, finishJob } from "@/lib/jobs";
import { allow, limitKey } from "@/lib/ratelimit";
import { storeDocument, type StoreOutcome } from "@/lib/library/store";

// Manual upload POST. Admin only, same origin, rate limited, one job row per batch.
export async function POST(request: Request) {
  if (!isSameOrigin(request)) return new Response("Forbidden", { status: 403 });
  const session = await adminSession();
  if (!session) return redirectTo(request, "/admin/login");
  const back = (e: string) => redirectTo(request, `/admin/library/upload?e=${e}`);

  const length = Number(request.headers.get("content-length") ?? "0");
  if (!Number.isFinite(length) || length > LIBRARY.maxUploadBytes + 1024 * 1024) return back("too_big");

  const env = await getEnv();
  if (!(await allow(env.DB, await limitKey("upload", session.actorId), LIBRARY.uploadsPerHour, 3_600_000))) {
    return back("busy");
  }

  let files: File[];
  try {
    files = (await request.formData()).getAll("files").filter((f): f is File => f instanceof File && f.size > 0);
  } catch {
    return back("failed");
  }
  if (files.length === 0) return back("none");
  if (files.length > LIBRARY.maxFilesPerUpload) return back("too_many");
  if (files.reduce((a, f) => a + f.size, 0) > LIBRARY.maxUploadBytes) return back("too_big");

  const jobId = await createJob(env.DB, "source_upload", session.actorId, { files: files.length });
  const outcomes: StoreOutcome[] = [];
  let errorRef: string | null = null;
  for (const f of files) {
    try {
      const bytes = new Uint8Array(await f.arrayBuffer());
      outcomes.push(
        await storeDocument(env.DB, env.SOURCE, { fileName: f.name, bytes, actorId: session.actorId, origin: "upload", jobId }),
      );
    } catch (err) {
      errorRef ??= newErrorRef();
      reportError("library.upload", err, errorRef);
      outcomes.push({ fileName: String(f.name).slice(0, 80), ok: false, reason: "storage" });
    }
  }
  await finishJob(env.DB, jobId, errorRef ? "failed" : "succeeded", { files: outcomes }, errorRef);
  return redirectTo(request, `/admin/library/upload?job=${encodeURIComponent(jobId)}`);
}
