import type { Metadata } from "next";
import Link from "next/link";
import { requireAdmin } from "@/lib/auth/guard";
import { getEnv } from "@/lib/env";
import { AdminShell, Notice } from "@/components/AdminShell";
import { LIBRARY } from "@/lib/config";
import { getJob } from "@/lib/jobs";
import { getLibrarySettings } from "@/lib/settings";
import { REASON_LABELS } from "@/lib/library/labels";
import type { StoreOutcome } from "@/lib/library/store";

export const metadata: Metadata = { title: "Upload source files" };

const MESSAGES = {
  none: "Choose at least one PDF.",
  too_many: `Up to ${LIBRARY.maxFilesPerUpload} files at a time.`,
  too_big: `Up to ${LIBRARY.maxUploadBytes / 1024 / 1024} MB per upload.`,
  busy: "Too many uploads this hour. Please wait a little.",
  failed: "The upload could not be finished. Please try again.",
};

export default async function UploadPage({ searchParams }: { searchParams: Promise<{ job?: string; e?: string }> }) {
  const { actorId } = await requireAdmin();
  const q = await searchParams;
  const env = await getEnv();
  const lib = await getLibrarySettings(env.DB);
  const job = q.job ? await getJob(env.DB, q.job, "source_upload") : null;
  const outcomes: StoreOutcome[] = job && job.created_by === actorId ? (JSON.parse(job.result).files ?? []) : [];
  const stored = outcomes.filter((o) => o.ok).length;

  return (
    <AdminShell
      current="/admin/library/upload"
      title="Upload source files"
      intro={<>PDFs that already have Cambridge file names, like <span className="mono">0625_s23_qp_42.pdf</span>. For a Google Drive folder with other names (&quot;2024 / May June&quot;), use Upload a folder: it works out each file and shows you the result first.</>}
      actions={<Link className="btn btn-primary" href="/admin/library/folder">Upload a folder</Link>}
    >
      <Notice code={q.e} messages={MESSAGES} />

      {job ? (
        <section className="card stack">
          <h2 className="subtitle">
            {stored} of {outcomes.length} stored
          </h2>
          <ul className="list">
            {outcomes.map((o, i) => (
              <li className="list-row" key={i}>
                <span className="mono">{o.fileName}</span>
                <span className={o.ok ? "pill pill-ok" : "pill pill-gap"}>{o.ok ? "Stored" : REASON_LABELS[o.reason]}</span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <form className="card stack" method="post" action="/admin/library/upload/send" encType="multipart/form-data">
        <h2 className="subtitle">Choose files</h2>
        <p className="muted">
          From {lib.fromYear} to{" "}
          {lib.toYear}. Up to {LIBRARY.maxFilesPerUpload} files and {LIBRARY.maxUploadBytes / 1024 / 1024} MB at a time.
          Files already stored are skipped.
        </p>
        <label className="label" htmlFor="files">PDF files</label>
        <input className="input" id="files" name="files" type="file" accept=".pdf,application/pdf" multiple required />
        <div className="form-actions"><button className="btn btn-primary" type="submit">Upload</button></div>
      </form>
    </AdminShell>
  );
}
