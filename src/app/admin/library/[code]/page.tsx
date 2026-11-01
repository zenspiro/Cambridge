import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { requireAdmin } from "@/lib/auth/guard";
import { getEnv } from "@/lib/env";
import { AdminShell, Notice } from "@/components/AdminShell";
import { CellLink, GroupPill, StatusLine } from "@/components/LibraryBits";
import { DOC_TYPE_LABELS, SESSION_LABELS } from "@/lib/config";
import { libraryYears, getLibrarySettings } from "@/lib/settings";
import { loadHeader, loadSyllabus, tone } from "@/lib/library/catalog";
import { filterChecklist, type ChecklistFilter, type PaperRow } from "@/lib/library/checklist";
import { formatBytes } from "@/lib/library/labels";

export const metadata: Metadata = { title: "Library" };

const MESSAGES = {
  ok_added: "File added to the library.",
};

const pick = <T extends string>(v: string | undefined, allowed: readonly T[]): T | null =>
  v && (allowed as readonly string[]).includes(v) ? (v as T) : null;

function PaperTable({ rows, types, specimen = false }: { rows: PaperRow[]; types: string[]; specimen?: boolean }) {
  if (rows.length === 0) return null;
  return (
    <table className="grid-table">
      <thead>
        <tr>
          <th scope="col">Paper</th>
          {types.map((t) => (
            <th scope="col" key={t}>
              <abbr title={DOC_TYPE_LABELS[t]}>{t === "sp" ? "QP" : t === "sm" ? "MS" : t.toUpperCase()}</abbr>
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={`${r.paper}-${r.variant}`} className={r.essential ? undefined : "row-extra"}>
            <th scope="row">
              {specimen ? `Paper ${r.paper}` : `${r.paper}${r.variant ?? ""}`}
              {!r.essential ? <span className="tag">extra</span> : null}
            </th>
            {types.map((t) => (
              <td key={t}>
                <CellLink cell={r.cells[t as keyof PaperRow["cells"]]} />
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export default async function SyllabusPage({
  params,
  searchParams,
}: {
  params: Promise<{ code: string }>;
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  await requireAdmin();
  const { code } = await params;
  const q = await searchParams;
  const env = await getEnv();
  const lib = await getLibrarySettings(env.DB);
  const [list, header] = await Promise.all([loadSyllabus(env.DB, code, lib), loadHeader(env.DB, code)]);
  if (!list || !header) redirect("/admin/library?e=unknown");

  const years = libraryYears(lib).map(String);
  const filter: ChecklistFilter = {
    year: pick(q.year, years) ? Number(q.year) : null,
    session: pick(q.session, ["m", "s", "w", "y"] as const),
    type: pick(q.type, Object.keys(DOC_TYPE_LABELS)),
    paper: pick(q.paper, ["1", "2", "3", "4", "5", "6"]) ? Number(q.paper) : null,
    status: pick(q.status, ["have", "missing", "extras"] as const),
    q: (q.q ?? "").slice(0, 100),
  };
  const view = filterChecklist(list, filter);
  const open = (t: string) => view.filtered || t !== "ok";

  return (
    <AdminShell current="/admin/library" title={`${header.subject_name} (${code})`}>
      <nav className="crumbs" aria-label="Breadcrumb">
        <Link className="link" href="/admin/library">Library</Link>
        <span aria-hidden="true">›</span>
        <span>{header.qualification_name}</span>
        <span aria-hidden="true">›</span>
        <span aria-current="page">{header.subject_name} {code}</span>
      </nav>
      <Notice code={q.e} messages={MESSAGES} />

      <section className="card stack">
        <StatusLine status={list.status} />
        <p className="muted">
          {lib.fromYear} to {lib.toYear}, up to {SESSION_LABELS[lib.lastSession.session]} {lib.lastSession.year}. Essential:
          syllabus, specimens, and for each session variant {lib.essentialVariants.s.join(", ")} (March{" "}
          {lib.essentialVariants.m.join(", ")}) of every paper, plus the examiner report and grade thresholds. Change in{" "}
          <Link className="link" href="/admin/settings">Settings</Link>.
        </p>
      </section>

      <form className="card filters filters-6" method="get" role="search">
        <label className="field field-wide">
          <span className="label-inline">Search</span>
          <input className="input" name="q" type="search" maxLength={100} defaultValue={filter.q ?? ""} placeholder="e.g. paper 4 mark scheme" />
        </label>
        <label className="field">
          <span className="label-inline">Year</span>
          <select className="input" name="year" defaultValue={q.year ?? ""}>
            <option value="">All</option>
            {years.map((y) => <option key={y} value={y}>{y}</option>)}
          </select>
        </label>
        <label className="field">
          <span className="label-inline">Session</span>
          <select className="input" name="session" defaultValue={filter.session ?? ""}>
            <option value="">All</option>
            {Object.entries(SESSION_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </label>
        <label className="field">
          <span className="label-inline">Type</span>
          <select className="input" name="type" defaultValue={filter.type ?? ""}>
            <option value="">All</option>
            {Object.entries(DOC_TYPE_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </label>
        <label className="field">
          <span className="label-inline">Paper</span>
          <select className="input" name="paper" defaultValue={filter.paper ? String(filter.paper) : ""}>
            <option value="">All</option>
            {["1", "2", "3", "4", "5", "6"].map((p) => <option key={p} value={p}>{p}</option>)}
          </select>
        </label>
        <label className="field">
          <span className="label-inline">Status</span>
          <select className="input" name="status" defaultValue={filter.status ?? ""}>
            <option value="">All</option>
            <option value="missing">Missing essentials</option>
            <option value="have">Stored</option>
            <option value="extras">Extras</option>
          </select>
        </label>
        <div className="filter-actions">
          <button className="btn btn-primary" type="submit">Apply</button>
          <Link className="btn" href={`/admin/library/${code}`}>Clear</Link>
        </div>
      </form>

      {view.filtered ? (
        <p className="muted">
          {view.matches} {view.matches === 1 ? "file matches" : "files match"}.
        </p>
      ) : null}

      <ul className="legend muted" aria-label="Key">
        <li className="legend-item"><span className="cell cell-have" aria-hidden="true">✓</span> Stored (click to download)</li>
        <li className="legend-item"><span className="cell cell-miss" aria-hidden="true">✕</span> Essential, missing</li>
        <li className="legend-item"><span className="cell cell-extra" aria-hidden="true">+</span> Extra, not stored</li>
        <li className="legend-item">Click a missing file to add it.</li>
      </ul>

      {view.versions.length > 0 ? <h2 className="subtitle section-title">Syllabus and specimens</h2> : null}
      {view.versions.map((g) => (
        <details className="card group" key={g.version.id} open={open(tone(g.status))}>
          <summary className="group-head">
            <span className="subtitle">{g.label}</span>
            <GroupPill status={g.status} />
          </summary>
          <div className="group-body">
            {g.docs.length > 0 ? (
              <div className="doc-chips">
                {g.docs.map((c) => (
                  <span className="doc-chip" key={c.fileName}>
                    <CellLink cell={c} label={`${DOC_TYPE_LABELS[c.docType]}${c.essential ? "" : " (extra)"}`} />
                  </span>
                ))}
              </div>
            ) : null}
            {g.specimens.length > 0 ? (
              <>
                <h3 className="label-inline">Specimen papers</h3>
                <PaperTable rows={g.specimens} types={["sp", "sm", "ci"]} specimen />
              </>
            ) : null}
          </div>
        </details>
      ))}

      {view.sessions.length > 0 ? <h2 className="subtitle section-title">Exam sessions</h2> : null}
      {view.sessions.map((g) => (
        <details className="card group" key={`${g.year}${g.session}`} open={open(tone(g.status))}>
          <summary className="group-head">
            <span className="subtitle">{g.label}</span>
            <GroupPill status={g.status} />
          </summary>
          <div className="group-body">
            {g.docs.length > 0 ? (
              <div className="doc-chips">
                {g.docs.map((c) => (
                  <span className="doc-chip" key={c.fileName}>
                    <CellLink cell={c} label={DOC_TYPE_LABELS[c.docType]} />
                  </span>
                ))}
              </div>
            ) : null}
            <PaperTable rows={g.rows} types={["qp", "ms", "ci"]} />
          </div>
        </details>
      ))}

      {view.others.length > 0 ? (
        <details className="card group" open={view.filtered}>
          <summary className="group-head">
            <span className="subtitle">Other stored files</span>
            <span className="pill">{view.others.length}</span>
          </summary>
          <ul className="list group-body">
            {view.others.map((c) => (
              <li className="list-row" key={c.fileName}>
                <span className="mono">{c.fileName}</span>
                <span className="actions">
                  {c.doc ? <span className="muted">{formatBytes(c.doc.size_bytes)}</span> : null}
                  <CellLink cell={c} label="Download" />
                </span>
              </li>
            ))}
          </ul>
        </details>
      ) : null}

      {view.filtered && view.matches === 0 ? (
        <section className="card"><p className="muted">Nothing matches these filters.</p></section>
      ) : null}
    </AdminShell>
  );
}
