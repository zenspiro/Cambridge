import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { requireStaff, allowed, ADMIN_EDIT } from "@/lib/auth/staff";
import { getEnv } from "@/lib/env";
import { AdminShell, FreeTag, Notice } from "@/components/AdminShell";
import { QUEUE_MESSAGES } from "@/lib/brain/labels";
import { ActionForm } from "@/components/ActionForm";
import { DocumentsTable } from "@/components/DocumentsTable";
import { RunProgress } from "@/components/RunProgress";
import { BRAIN } from "@/lib/config";
import { loadHeader } from "@/lib/library/catalog";
import { listParam, loadDocRows, readDocFilter, reviewSummary } from "@/lib/library/documents";
import { latestBatch } from "@/lib/brain/runs";

export const metadata: Metadata = { title: "Documents" };

const MESSAGES = {
  ok_check: "Checking again started. Progress shows above; new flags show on each paper.",
  check_none: "No paper of this subject has been read yet, so there is nothing to check.",
  busy: "Too many runs this hour. Please wait a little.",
  ...QUEUE_MESSAGES,
};

// One subject's documents (owner, 10 Nov 2026): every stored file with the AI's read accuracy and a person's review,
// a filter on every column. The subject overview keeps a one-line summary and links here.
export default async function SubjectDocuments({ params, searchParams }: { params: Promise<{ code: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { code } = await params;
  const staff = await requireStaff({ area: "library", level: "view", code });
  const owner = allowed(staff, ADMIN_EDIT);
  const sp = await searchParams;
  const env = await getEnv();
  const header = await loadHeader(env.DB, code);
  if (!header) redirect("/admin/library?e=unknown");
  const [rows, batchRun] = await Promise.all([loadDocRows(env.DB, [code]), latestBatch(env.DB, code)]);
  const filter = readDocFilter((k) => listParam(sp[k]));
  const sum = reviewSummary(rows);
  return (
    <AdminShell
      current="/admin/library/documents"
      title={`Documents: ${header.subject_name} ${code}`}
      intro="Every file stored for this subject, with how well the AI read it and whether a person has reviewed it. Filter any column; click a heading to sort."
      crumbs={[{ label: "Library", href: "/admin/library" }, { label: `${header.subject_name} ${code}`, href: `/admin/library/${code}` }, { label: "Documents" }]}
      actions={owner && sum.read ? (
        // Run the checks again on all of them (owner, 9 Nov 2026): no AI, so nothing is spent.
        <ActionForm action={`/admin/library/${code}/check-all`} messages={MESSAGES} yes="Yes" no="No"
          confirm={`Check all ${Math.min(sum.read, BRAIN.maxBatchPapers)} again? Free.`}>
          <button className="btn" type="submit">Run the checks again on all <FreeTag /></button>
        </ActionForm>
      ) : null}
    >
      <Notice code={typeof sp.e === "string" ? sp.e : undefined} messages={MESSAGES} />
      {batchRun ? <section className="card"><RunProgress key={batchRun.id} runId={batchRun.id} stages={["pdf", "gemini", "claude", "figures", "checks", "save"]} /></section> : null}
      <DocumentsTable rows={rows} filter={filter} base={`/admin/library/${code}/documents`} showSubject={false} />
    </AdminShell>
  );
}
