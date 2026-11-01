import type { Metadata } from "next";
import Link from "next/link";
import { requireAdmin } from "@/lib/auth/guard";
import { getEnv } from "@/lib/env";
import { AdminShell } from "@/components/AdminShell";
import { DOC_TYPE_LABELS, LIBRARY, SESSION_LABELS } from "@/lib/config";
import { getLibrarySettings, libraryYears } from "@/lib/settings";
import { LIST_DOCUMENTS } from "@/lib/library/queries";
import { dateFmt, describeDoc, formatBytes, sessionLabel } from "@/lib/library/labels";

export const metadata: Metadata = { title: "Source library" };

type Row = {
  id: string; file_name: string; session: string; year: number; paper: number | null; variant: number | null;
  doc_type: string; size_bytes: number; origin: string; acquired_at: number;
};

// Filters come from the address bar, so each is checked against an allowlist.
function pick<T extends string>(v: string | undefined, allowed: readonly T[]): T | null {
  return v && (allowed as readonly string[]).includes(v) ? (v as T) : null;
}

export default async function LibraryPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  await requireAdmin();
  const q = await searchParams;
  const env = await getEnv();
  const lib = await getLibrarySettings(env.DB);
  const years = libraryYears(lib).map(String);
  const year = pick(q.year, years);
  const session = pick(q.session, Object.keys(SESSION_LABELS));
  const type = pick(q.type, Object.keys(DOC_TYPE_LABELS));
  const paper = pick(q.paper, ["1", "2", "3", "4", "5", "6"]);

  const { results } = await env.DB.prepare(LIST_DOCUMENTS)
    .bind("0625", year ? Number(year) : null, session, type, paper ? Number(paper) : null, LIBRARY.pageSize)
    .all<Row>();

  // Group by session for reading.
  const groups = new Map<string, Row[]>();
  for (const r of results) {
    const k = sessionLabel(r.session, r.year);
    groups.set(k, [...(groups.get(k) ?? []), r]);
  }

  return (
    <AdminShell current="/admin/library" title="Source library">
      <p className="muted">Physics 0625, {lib.fromYear} to {lib.toYear}. Admin only. Every download is logged.</p>

      <form className="card filters" method="get">
        <label className="field">
          <span className="label-inline">Year</span>
          <select className="input" name="year" defaultValue={year ?? ""}>
            <option value="">All</option>
            {years.map((y) => <option key={y} value={y}>{y}</option>)}
          </select>
        </label>
        <label className="field">
          <span className="label-inline">Session</span>
          <select className="input" name="session" defaultValue={session ?? ""}>
            <option value="">All</option>
            {Object.entries(SESSION_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </label>
        <label className="field">
          <span className="label-inline">Type</span>
          <select className="input" name="type" defaultValue={type ?? ""}>
            <option value="">All</option>
            {Object.entries(DOC_TYPE_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </label>
        <label className="field">
          <span className="label-inline">Paper</span>
          <select className="input" name="paper" defaultValue={paper ?? ""}>
            <option value="">All</option>
            {["1", "2", "3", "4", "5", "6"].map((p) => <option key={p} value={p}>{p}</option>)}
          </select>
        </label>
        <div className="filter-actions">
          <button className="btn btn-primary" type="submit">Filter</button>
          <Link className="btn" href="/admin/library">Clear</Link>
        </div>
      </form>

      {results.length === 0 ? (
        <section className="card stack">
          <p className="muted">
            No files match. <Link className="link" href="/admin/library/upload">Upload some</Link>.
          </p>
        </section>
      ) : (
        [...groups.entries()].map(([label, rows]) => (
          <section className="card stack" key={label}>
            <h2 className="subtitle">{label}</h2>
            <ul className="list">
              {rows.map((r) => (
                <li className="list-row" key={r.id}>
                  <span className="doc-main">
                    <span className="mono">{r.file_name}</span>
                    <span className="muted">{describeDoc(r)}</span>
                  </span>
                  <span className="doc-meta muted">
                    {formatBytes(r.size_bytes)} · {r.origin === "agent" ? "Agent" : "Upload"} · {dateFmt.format(r.acquired_at)}
                  </span>
                  <a className="btn btn-small" href={`/admin/library/file/${encodeURIComponent(r.id)}`}>Download</a>
                </li>
              ))}
            </ul>
          </section>
        ))
      )}
      {results.length === LIBRARY.pageSize ? (
        <p className="muted">Showing the first {LIBRARY.pageSize}. Use the filters to narrow it down.</p>
      ) : null}
    </AdminShell>
  );
}
