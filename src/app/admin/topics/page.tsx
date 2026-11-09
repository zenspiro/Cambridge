import { ADMIN_EDIT, ADMIN_VIEW, allowed, requireStaff } from "@/lib/auth/staff";
import type { Metadata } from "next";
import Link from "next/link";
import { getEnv } from "@/lib/env";
import { AdminShell } from "@/components/AdminShell";
import { listSubjects, subjectLabel } from "@/lib/library/catalog";
import { allTrees, isActive, type TreeRow } from "@/lib/brain/runs";

export const metadata: Metadata = { title: "Topic trees" };

const STATUS = { ready: ["pill pill-ok", "Ready"], not_ready: ["pill pill-gap", "Not ready"], none: ["pill", "Not drafted"] } as const;

// Every subject's topic trees on one page (the sidebar's "Topic trees"). Drafting stays on each subject's page.
export default async function TopicTreesPage() {
  const staff = await requireStaff(ADMIN_VIEW);
  const env = await getEnv();
  const [rows, subjects] = await Promise.all([allTrees(env.DB), listSubjects(env.DB)]);
  const byCode = new Map<string, TreeRow[]>();
  for (const r of rows) byCode.set(r.code, [...(byCode.get(r.code) ?? []), r]);
  const ready = rows.filter((r) => r.status === "ready").length;
  return (
    <AdminShell
      readOnly={!allowed(staff, ADMIN_EDIT)}
      current="/admin/topics"
      title="Topic trees"
      intro={<>{ready} of {rows.length} syllabus versions have a ready topic tree. Open a subject to draft or redraft its trees.</>}
    >
      <section className="card">
        <table className="info-table">
          <thead>
            <tr><th scope="col">Subject</th><th scope="col">Syllabus</th><th scope="col">Topic tree</th><th scope="col">Size</th><th scope="col">Syllabus PDF</th></tr>
          </thead>
          <tbody>
            {[...byCode].flatMap(([code, list]) =>
              list.map((r, i) => (
                <tr key={r.syllabusId}>
                  <td>{i === 0 ? <Link className="link" href={`/admin/library/${code}/topics`}>{subjectLabel(subjects, code)}</Link> : null}</td>
                  <td>{r.fromYear} to {r.toYear}</td>
                  <td>
                    <span className={STATUS[r.status][0]}>{STATUS[r.status][1]}</span>
                    {isActive(r.run) ? <span className="muted"> drafting now</span> : r.run?.status === "failed" ? <span className="muted"> last run stopped</span> : null}
                  </td>
                  <td>{r.status === "none" ? "" : <Link className="link" href={`/admin/library/${code}/topics/${r.fromYear}`}>{r.topics} topics, {r.goals} goals</Link>}</td>
                  <td>{r.pdf ? "In the library" : <span className="muted">Missing</span>}</td>
                </tr>
              )),
            )}
          </tbody>
        </table>
      </section>
    </AdminShell>
  );
}
