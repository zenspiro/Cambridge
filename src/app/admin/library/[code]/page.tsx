import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { requireAdmin } from "@/lib/auth/guard";
import { getEnv } from "@/lib/env";
import { AdminShell, Notice } from "@/components/AdminShell";
import { CellLink, StatusLine } from "@/components/LibraryBits";
import { Crumbs, Legend } from "@/components/LibraryTables";
import { DOC_TYPE_LABELS, SESSION_LABELS } from "@/lib/config";
import { getLibrarySettings, libraryYears } from "@/lib/settings";
import { loadHeader, loadSyllabus } from "@/lib/library/catalog";
import { essentialFor, filterChecklist, groupCells, type Cell, type ChecklistFilter } from "@/lib/library/checklist";
import { describeFile, duration, loadPapers, paperLookup, routeText, TIER_LABELS } from "@/lib/library/papers";
import { type ExamSession } from "@/lib/library/slugs";
import { buildSubjectMap } from "@/lib/library/map";
import { SubjectMapVersion } from "@/components/SubjectMap";
import { ScoreBadge } from "@/components/ScoreBadge";
import { rowScore } from "@/lib/brain/paperRead";

export const metadata: Metadata = { title: "Library" };

const MESSAGES = {
  ok_added: "File added to the library.",
  ok_variants: "Essential variants saved for this syllabus.",
  bad_variants: "Tick at least one variant for each session.",
  busy: "Too many changes this hour. Please wait a little.",
};

const pick = <T extends string>(v: string | undefined, allowed: readonly T[]): T | null =>
  v && (allowed as readonly string[]).includes(v) ? (v as T) : null;

export default async function SyllabusOverview({
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
  const [list, header, { papers, routes }] = await Promise.all([
    loadSyllabus(env.DB, code, lib),
    loadHeader(env.DB, code),
    loadPapers(env.DB, code),
  ]);
  if (!list || !header) redirect("/admin/library?e=unknown");
  const look = paperLookup(papers);

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

  // Flat results for search and filters, described in plain words.
  const results: { cell: Cell; versionId: string | null }[] = view.filtered
    ? [
        ...view.versions.flatMap((g) => groupCells(g).map((cell) => ({ cell, versionId: g.version.id }))),
        ...view.sessions.flatMap((g) => groupCells(g).map((cell) => ({ cell, versionId: g.versionId }))),
        ...view.others.map((cell) => ({ cell, versionId: cell.doc?.syllabus_id ?? null })),
      ]
    : [];

  const worst = [...list.sessions]
    .filter((g) => g.status.essentialHave < g.status.essentialTotal)
    .sort((a, b) => (b.status.essentialTotal - b.status.essentialHave) - (a.status.essentialTotal - a.status.essentialHave) || b.year - a.year)
    .slice(0, 3);
  const missing = list.status.essentialTotal - list.status.essentialHave;
  const newest = list.versions[0];
  const newestPapers = papers.filter((p) => p.syllabus_id === newest?.version.id);
  const newestRoutes = routes.filter((r) => r.syllabus_id === newest?.version.id);
  const ownVariants = essentialFor(list.versions[0]?.version, lib);
  const allVariants = q.variants === "all";
  const map = buildSubjectMap(list, papers, { allVariants });
  // Papers read so far, with their read accuracy (owner, 7 Nov 2026), weakest first so they stand out.
  const { results: readRows } = await env.DB
    .prepare(`SELECT p.doc_id, p.items, p.flags, p.read_at, p.first_items, p.first_clean, p.first_red, d.file_name, d.syllabus_id
              FROM paper_read p JOIN source_document d ON d.id = p.doc_id
              WHERE p.read_at IS NOT NULL AND d.syllabus_id LIKE ?1 ORDER BY p.read_at DESC LIMIT 200`)
    .bind(`${code}-%`)
    .all<{ doc_id: string; items: number; flags: string; read_at: number; first_items: number | null; first_clean: number | null; first_red: number | null; file_name: string; syllabus_id: string }>();
  const read = readRows.map((r) => ({ ...r, score: rowScore(r) })).sort((a, b) => (a.score?.pct ?? 101) - (b.score?.pct ?? 101));

  return (
    <AdminShell current="/admin/library" title={`${header.subject_name} ${code}`}>
      <Crumbs items={[{ label: "Library", href: "/admin/library" }, { label: header.qualification_name }, { label: `${header.subject_name} ${code}` }]} />
      <Notice code={q.e} messages={MESSAGES} errorRef={q.ref} />

      <section className="card stack">
        <StatusLine status={list.status} />
        {missing > 0 ? (
          <p>
            <Link className="link" href={`/admin/library/${code}?status=missing`}>{missing} essential files missing</Link>
            {worst.length > 0 ? <span className="muted">. Most missing: {worst.map((g) => `${g.label} (${g.status.essentialHave} of ${g.status.essentialTotal})`).join(", ")}.</span> : null}
          </p>
        ) : (
          <p className="notice">Every essential file is in.</p>
        )}
        <p className="row-actions">
          <Link className="btn btn-small" href={`/admin/agent?code=${code}`}>Run the agent for this subject</Link>
          <Link className="btn btn-small" href={`/admin/library/${code}/topics`}>Topic tree</Link>
        </p>
      </section>

      {read.length ? (
        <section className="card stack" id="papers-read">
          <h2 className="subtitle">Papers read ({read.length})</h2>
          <p className="muted m-0">Read accuracy: how well the AIs read each paper by themselves on its first reading. Weakest first.</p>
          <ul className="review-list">
            {read.map((r) => (
              <li key={r.doc_id} className="review-list-row">
                <span>{describeFile(r.file_name, r.syllabus_id, look)}</span>
                <ScoreBadge score={r.score} />
                <span />
                {/* A full page load: the review page's own security policy frames the PDF. */}
                <a className="btn btn-small" href={`/admin/library/review/${encodeURIComponent(r.doc_id)}`}>Review</a>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {!view.filtered ? (
        <>
        <section className="card stack">
          <div className="row-between">
            <h2 className="subtitle">Subject map</h2>
            <span className="map-actions">
              {allVariants
                ? <Link className="btn btn-small" href={`/admin/library/${code}`}>Essential variants only</Link>
                : <Link className="btn btn-small" href={`/admin/library/${code}?variants=all`}>All variants</Link>}
              <a className="btn btn-small" href={`/admin/library/${code}/map`}>Download map</a>
            </span>
          </div>
          <p className="muted">
            Every syllabus version with its documents and specimens, then each exam session with every paper&apos;s files
            ({allVariants ? "all variants" : "essential variants"}), newest first. A tick downloads the file; a cross or + adds it.
            The map file holds the same structure for the AI.
          </p>
        </section>
        {map.map((v) => <SubjectMapVersion key={v.id} code={code} v={v} />)}
        </>
      ) : null}

      <form className="card filters filters-compact" method="get" role="search">
        <label className="field field-search">
          <span className="sr-only">Search this syllabus</span>
          <input className="input" name="q" type="search" maxLength={100} defaultValue={filter.q ?? ""} placeholder="Search, e.g. mark scheme 2024 paper 4" />
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
        <label className="field">
          <span className="label-inline">Year</span>
          <select className="input" name="year" defaultValue={q.year ?? ""}>
            <option value="">All</option>
            {years.map((y) => <option key={y} value={y}>{y}</option>)}
          </select>
        </label>
        <details className="more-filters" open={!!(filter.session || filter.type || filter.paper)}>
          <summary className="link">More filters</summary>
          <div className="filters-more">
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
          </div>
        </details>
        <div className="filter-actions">
          <button className="btn btn-primary" type="submit">Show</button>
          {view.filtered ? <Link className="btn" href={`/admin/library/${code}`}>Clear</Link> : null}
        </div>
      </form>

      {view.filtered ? (
        <section className="card stack">
          <h2 className="subtitle">{results.length} {results.length === 1 ? "file" : "files"}</h2>
          {results.length === 0 ? <p className="muted">Nothing matches.</p> : null}
          <ul className="list">
            {results.slice(0, 300).map(({ cell, versionId }) => (
              <li className="list-row result-row" key={cell.fileName}>
                <span className="doc-main">
                  <span>{describeFile(cell.fileName, versionId, look)}</span>
                  <span className="mono muted">{cell.fileName}{!cell.doc && !cell.essential ? " · extra" : ""}</span>
                </span>
                <CellLink cell={cell} label={cell.doc ? "Download" : "Add"} />
              </li>
            ))}
          </ul>
          {results.length > 300 ? <p className="muted">Showing the first 300. Narrow it down with the filters.</p> : null}
        </section>
      ) : (
        <>
          {newest && newestPapers.length > 0 ? (
            <section className="card stack">
              <h2 className="subtitle">Papers ({newest.version.valid_from_year} to {newest.version.valid_to_year} syllabus)</h2>
              <table className="info-table">
                <thead>
                  <tr><th scope="col">Paper</th><th scope="col">Name</th><th scope="col">Time</th><th scope="col">Marks</th></tr>
                </thead>
                <tbody>
                  {newestPapers.map((p) => (
                    <tr key={p.paper}>
                      <th scope="row">{p.paper}</th>
                      <td>
                        {p.name}{p.tier !== "all" ? <span className={`tag tag-${p.tier}`}>{TIER_LABELS[p.tier]}</span> : null}
                        {p.note ? <span className="muted"> · {p.note}</span> : null}
                      </td>
                      <td>{p.school_assessed ? "Marked by the school" : duration(p.duration_min)}</td>
                      <td>{p.marks}{p.weighting_pct ? ` (${p.weighting_pct}%)` : ""}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <ul className="routes">
                {newestRoutes.map((r) => (
                  <li key={r.name}><strong>{r.name}:</strong> {routeText(r.papers)}{r.grades ? `, grades ${r.grades}` : ""}</li>
                ))}
              </ul>
            </section>
          ) : null}

          {list.others.length > 0 ? (
            <details className="card group">
              <summary className="group-head">
                <span className="subtitle">Other stored files</span>
                <span className="pill">{list.others.length}</span>
              </summary>
              <ul className="list group-body">
                {list.others.map((c) => (
                  <li className="list-row result-row" key={c.fileName}>
                    <span className="doc-main">
                      <span>{describeFile(c.fileName, c.doc?.syllabus_id ?? null, look)}</span>
                      <span className="mono muted">{c.fileName}</span>
                    </span>
                    <CellLink cell={c} label="Download" />
                  </li>
                ))}
              </ul>
            </details>
          ) : null}

          <form className="card stack" method="post" action="/admin/library/variants">
            <h2 className="subtitle">Essential variants for {code}</h2>
            <p className="muted">Which variants of each paper must be stored for a session to be complete. Pakistan sits variant 2.</p>
            <input type="hidden" name="code" value={code} />
            <div className="variant-grid">
              {(["m", "s", "w"] as ExamSession[]).map((s) => (
                <fieldset className="fieldset" key={s}>
                  <legend className="label-inline">{SESSION_LABELS[s]}</legend>
                  <div className="checks">
                    {[1, 2, 3].map((v) => (
                      <label className="check" key={v}>
                        <input type="checkbox" name={`ev_${s}`} value={v} defaultChecked={ownVariants[s].includes(v)} /> {v}
                      </label>
                    ))}
                  </div>
                </fieldset>
              ))}
            </div>
            <button className="btn" type="submit">Save variants</button>
          </form>
        </>
      )}
      <Legend />
    </AdminShell>
  );
}
