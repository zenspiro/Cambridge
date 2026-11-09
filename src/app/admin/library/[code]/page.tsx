import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { requireStaff, allowed, ADMIN_EDIT, ADMIN_VIEW } from "@/lib/auth/staff";
import { getEnv } from "@/lib/env";
import { AdminShell, Notice } from "@/components/AdminShell";
import { CellLink, StatusLine } from "@/components/LibraryBits";
import { Legend } from "@/components/LibraryTables";
import { BRAIN, DOC_TYPE_LABELS, SESSION_LABELS } from "@/lib/config";
import { getLibrarySettings, libraryYears } from "@/lib/settings";
import { loadHeader, loadSyllabus } from "@/lib/library/catalog";
import { essentialFor, filterChecklist, groupCells, type Cell, type ChecklistFilter } from "@/lib/library/checklist";
import { describeFile, duration, loadPapers, paperLookup, routeText, TIER_LABELS } from "@/lib/library/papers";
import { type ExamSession } from "@/lib/library/slugs";
import { buildSubjectMap } from "@/lib/library/map";
import { SubjectMapVersion } from "@/components/SubjectMap";
import { ScoreBadge } from "@/components/ScoreBadge";
import { rowScore } from "@/lib/brain/paperRead";
import { ActionForm } from "@/components/ActionForm";
import { RunProgress } from "@/components/RunProgress";
import { latestBatch } from "@/lib/brain/runs";
import { RagDot } from "@/components/RagDot";
import { filterWords, hasTiers, planBatch, ragOf, readFilter, readStates, rowDocIds } from "@/lib/brain/readAll";
import { batchCostCheck, estimateWords, usdWords } from "@/lib/brain/spend";

export const metadata: Metadata = { title: "Library" };

const MESSAGES = {
  ok_added: "File added to the library.",
  ok_variants: "Essential variants saved for this syllabus.",
  bad_variants: "Tick at least one variant for each session.",
  busy: "Too many changes this hour. Please wait a little.",
  ok_batch: "Read all started. It reads the papers one after another; Running now in the sidebar shows where it is.",
  batch_none: "Nothing to read: every stored paper in this choice is read already.",
  over_cap: "This would go past your monthly AI cap, so it did not start. Raise the cap on AI setup, or read fewer papers.",
  no_price: "A model in use has no price, so the cap cannot be checked. Set its price on AI setup.",
  running: "Another AI run is going on. Wait for it to finish, then press Read all again.",
  not_set_up: "Starting runs is not set up (GITHUB_TOKEN or the workflow name is missing).",
  github: "GitHub refused to start the run. Check the GITHUB_TOKEN secret.",
  bad: "That choice could not be read. Pick again.",
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
  const { code } = await params;
  // Team members: their subjects only; uploads with library edit; Read all, the agent, topic trees and essential
  // variants stay with the owner (owner, 9 Nov 2026).
  const staff = await requireStaff({ area: "library", level: "view", code });
  // The whole admin (owner, 9 Nov 2026): view sees the agent and topic tree links; edit also Read all and variants.
  const owner = allowed(staff, ADMIN_EDIT);
  const adminView = allowed(staff, ADMIN_VIEW);
  const canEdit = allowed(staff, { area: "library", level: "edit", code });
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
  // Reading status per session row (owner, 8 Nov 2026), and Read all for the choice in the query.
  const states = await readStates(env.DB, code);
  for (const v of map) for (const r of v.rows) r.rag = ragOf(rowDocIds(r.cells), states);
  const yearNums = libraryYears(lib);
  const choice = readFilter((k) => q[k], yearNums);
  const tiered = hasTiers(papers);
  const plan = choice ? planBatch(list, papers, choice, states) : null;
  // The Read all running for this subject, or the last one (finished in the last 30 minutes): shown live in the card.
  const batchRun = await latestBatch(env.DB, code);
  const batchCost = plan?.toRead.length ? await batchCostCheck(env.DB, env, plan.toRead.map((d) => d.bytes)) : null;
  // Papers read so far, with their read accuracy (owner, 7 Nov 2026), weakest first so they stand out.
  const { results: readRows } = await env.DB
    .prepare(`SELECT p.doc_id, p.items, p.flags, p.read_at, p.first_items, p.first_clean, p.first_red, d.file_name, d.syllabus_id
              FROM paper_read p JOIN source_document d ON d.id = p.doc_id
              WHERE p.read_at IS NOT NULL AND d.syllabus_id LIKE ?1 ORDER BY p.read_at DESC LIMIT 200`)
    .bind(`${code}-%`)
    .all<{ doc_id: string; items: number; flags: string; read_at: number; first_items: number | null; first_clean: number | null; first_red: number | null; file_name: string; syllabus_id: string }>();
  const read = readRows.map((r) => ({ ...r, score: rowScore(r) })).sort((a, b) => (a.score?.pct ?? 101) - (b.score?.pct ?? 101));

  return (
    <AdminShell
      current="/admin/library"
      title={`${header.subject_name} ${code}`}
      crumbs={[{ label: "Library", href: "/admin/library" }, { label: header.qualification_name }, { label: `${header.subject_name} ${code}` }]}
      actions={<>
        {canEdit ? <Link className="btn btn-primary" href={`/admin/library/folder?code=${code}`}>Upload a folder</Link> : null}
        {adminView ? <Link className="btn" href={`/admin/agent?code=${code}`}>Run the agent</Link> : null}
        {adminView ? <Link className="btn" href={`/admin/library/${code}/topics`}>Topic tree</Link> : null}
      </>}
    >
      <Notice code={q.e} messages={MESSAGES} errorRef={q.ref} />
      <nav className="jump" aria-label="On this page">
        <span className="muted">On this page:</span>
        {owner ? <a className="link" href="#read-all">Read all</a> : null}
        {read.length ? <a className="link" href="#papers-read">Papers read</a> : null}
        {!view.filtered ? <a className="link" href="#map">Subject map</a> : null}
        <a className="link" href="#find">Search the files</a>
        <a className="link" href="#papers">Papers and routes</a>
        {owner ? <a className="link" href="#variants">Essential variants</a> : null}
      </nav>

      <section className="card stack" id="status">
        <StatusLine status={list.status} />
        {missing > 0 ? (
          <p>
            <Link className="link" href={`/admin/library/${code}?status=missing`}>{missing} essential files missing</Link>
            {worst.length > 0 ? <span className="muted">. Most missing: {worst.map((g) => `${g.label} (${g.status.essentialHave} of ${g.status.essentialTotal})`).join(", ")}.</span> : null}
          </p>
        ) : (
          <p className="notice">Every essential file is in.</p>
        )}
      </section>

      {owner ? <section className="card stack" id="read-all">
        <div className="card-head"><h2 className="subtitle">Read all</h2></div>
        <p className="hint m-0">
          Reads every stored question paper and mark scheme of the essential variants that is not read yet, one after
          another in one run. Papers read already are skipped; fix their flags on the review screen. Pick a month and a
          year, or leave them on every one.
        </p>
        {batchRun ? <RunProgress key={batchRun.id} runId={batchRun.id} stages={["pdf", "gemini", "claude", "figures", "checks", "save"]} /> : null}
        <form className="form-actions" method="get" action={`/admin/library/${code}#read-all`}>
          <label className="field">
            <span className="label-inline">Month</span>
            <select className="input" name="ras" defaultValue={choice?.session ?? ""}>
              <option value="">Every month</option>
              {(["m", "s", "w"] as const).map((s) => <option key={s} value={s}>{SESSION_LABELS[s]}</option>)}
            </select>
          </label>
          <label className="field">
            <span className="label-inline">Year</span>
            <select className="input" name="ray" defaultValue={choice?.year ? String(choice.year) : ""}>
              <option value="">Every year</option>
              {[...yearNums].sort((a, b) => b - a).map((y) => <option key={y} value={y}>{y}</option>)}
            </select>
          </label>
          {tiered ? (
            <>
              <button className="btn" type="submit" name="ra" value="core">Read all Core</button>
              <button className="btn" type="submit" name="ra" value="extended">Read all Extended</button>
            </>
          ) : <button className="btn" type="submit" name="ra" value="any">Read all</button>}
        </form>
        {choice && plan ? (
          <div className="stack-tight">
            <h3 className="subtitle">{filterWords(choice, SESSION_LABELS)}</h3>
            <p className="m-0">
              {plan.toRead.length + plan.over} to read, {plan.read} read already (skipped)
              {plan.missing ? `, ${plan.missing} not in the library (cannot be read)` : ""}.
              {tiered ? " Practical papers sat by both count for Core and Extended." : ""}
            </p>
            {plan.over ? <p className="alert m-0">One run reads {BRAIN.maxBatchPapers} at most: the first {BRAIN.maxBatchPapers} are read now, press Read all again for the other {plan.over}.</p> : null}
            {plan.toRead.length ? (
              <>
                <ol className="read-plan">
                  {plan.toRead.map((d) => <li key={d.docId}>{describeFile(d.fileName, d.syllabusId, look)}</li>)}
                </ol>
                {batchCost ? (
                  <p className={batchCost.verdict === "ok" ? "muted m-0" : "alert m-0"}>
                    {estimateWords(batchCost.estimate).replace("Rough cost:", `Rough cost for ${plan.toRead.length}:`)}
                    {batchCost.cap > 0 ? ` This month: ${usdWords(batchCost.spent)} of your ${usdWords(batchCost.cap)} cap.` : ""}
                    {batchCost.verdict === "over_cap" ? " This would go past the cap, so it will not start." : batchCost.verdict === "no_price" ? " With a cap set, runs need a price for every model in use." : ""}
                    {" "}The cap is checked again before each paper.
                  </p>
                ) : null}
                <ActionForm action={`/admin/library/${code}/read-all`} messages={MESSAGES} yes="Yes, proceed" no="No"
                  confirm={`Read ${plan.toRead.length} paper${plan.toRead.length === 1 ? "" : "s"}? This uses AI tokens: ${batchCost?.estimate.usd == null ? "cost unknown" : `about ${usdWords(batchCost.estimate.usd)}`}. Proceed?`}>
                  <input type="hidden" name="ra" value={choice.tier} />
                  {choice.session ? <input type="hidden" name="ras" value={choice.session} /> : null}
                  {choice.year ? <input type="hidden" name="ray" value={choice.year} /> : null}
                  <button className="btn btn-primary" type="submit">Read these {plan.toRead.length} papers</button>
                </ActionForm>
              </>
            ) : <p className="notice m-0">Nothing to read: every stored paper in this choice is read already.</p>}
          </div>
        ) : null}
      </section> : null}

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
        <section className="card stack" id="map">
          <div className="card-head">
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
          <p className="rag-legend m-0">
            <span>Dot before each session, reading status:</span>
            <span><RagDot rag="green" />all read and ready</span>
            <span><RagDot rag="amber" />partly read, or flags open</span>
            <span><RagDot rag="red" />not read yet</span>
            <span><RagDot rag={null} />no papers stored</span>
          </p>
        </section>
        {map.map((v) => <SubjectMapVersion key={v.id} code={code} v={v} />)}
        </>
      ) : null}

      <form className="card filters filters-compact" method="get" role="search" id="find">
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
            <section className="card stack" id="papers">
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

          {owner ? <form className="card stack" method="post" action="/admin/library/variants" id="variants">
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
          </form> : null}
        </>
      )}
      <Legend />
    </AdminShell>
  );
}
