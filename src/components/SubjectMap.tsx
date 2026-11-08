import Link from "next/link";
import { CellLink, GroupPill } from "@/components/LibraryBits";
import { RagDot } from "@/components/RagDot";
import { DOC_TYPE_LABELS } from "@/lib/config";
import { TIER_LABELS } from "@/lib/library/papers";
import { cellKey, SESSION_TYPES, type MapColumn, type MapVersion } from "@/lib/library/map";
import { sessionHref, versionHref } from "@/lib/library/slugs";

const SHORT: Record<string, string> = { qp: "QP", in: "Insert", ms: "MS", ci: "CI", sp: "QP", sm: "MS", pm: "Pre-release", qr: "Transcript" };

function Heads({ columns, tail }: { columns: MapColumn[]; tail: string[] }) {
  return (
    <thead>
      <tr>
        <th scope="col" rowSpan={2} className="map-first">Session</th>
        {columns.map((c) => (
          <th scope="colgroup" colSpan={c.types.length} key={c.paper} className="map-paper">
            <span className="map-paper-no">Paper {c.paper}</span>
            <span className="map-paper-name">{c.name}</span>
            {c.tier && c.tier !== "all" ? <span className={`tag tag-${c.tier}`}>{TIER_LABELS[c.tier]}</span> : null}
          </th>
        ))}
        {tail.length ? <th scope="colgroup" colSpan={tail.length} className="map-paper">Whole session</th> : null}
      </tr>
      <tr>
        {columns.flatMap((c) => c.types.map((t, i) => (
          <th scope="col" key={`${c.paper}-${t}`} className={i === 0 ? "map-sub map-start" : "map-sub"}>
            <abbr title={DOC_TYPE_LABELS[t]}>{SHORT[t] ?? t.toUpperCase()}</abbr>
          </th>
        )))}
        {tail.map((t, i) => (
          <th scope="col" key={t} className={i === 0 ? "map-sub map-start" : "map-sub"}><abbr title={DOC_TYPE_LABELS[t]}>{t.toUpperCase()}</abbr></th>
        ))}
      </tr>
    </thead>
  );
}

/** One syllabus version: its documents and specimens, then every exam session as a row. */
export function SubjectMapVersion({ code, v }: { code: string; v: MapVersion }) {
  const tail: string[] = SESSION_TYPES.filter((t) => v.rows.some((r) => r.docs?.[t]));
  return (
    <section className="card stack map-version" aria-labelledby={`v-${v.id}`}>
      <div className="row-between">
        <h2 className="subtitle" id={`v-${v.id}`}>
          <Link className="link" href={versionHref(code, v.from)}>{v.label}</Link>
        </h2>
        <span className="map-version-status"><span className="muted">Syllabus documents and specimens</span> <GroupPill status={v.status} /></span>
      </div>

      <div className="map-docs">
        <span className="label-inline">Syllabus documents</span>
        {v.docs.length ? v.docs.map((c) => <CellLink key={c.fileName} cell={c} label={DOC_TYPE_LABELS[c.docType]} />) : <span className="muted">Not asked for (older syllabus).</span>}
      </div>
      {v.specimens.columns.length ? (
        <div className="map-docs">
          <span className="label-inline">Specimen papers</span>
          {v.specimens.columns.map((c) => (
            <span className="map-spec" key={c.paper}>
              <span className="map-spec-no">P{c.paper}</span>
              {c.types.map((t) => <CellLink key={t} cell={v.specimens.cells[cellKey(c.paper, t)]} label={SHORT[t]} />)}
            </span>
          ))}
        </div>
      ) : null}

      {v.rows.length ? (
        <div className="map-scroll">
          <table className="map-table">
            <Heads columns={v.columns} tail={tail} />
            <tbody>
              {v.rows.map((r) => (
                <tr key={`${r.year}${r.session}${r.variant}${r.series ?? ""}`} className={[r.first ? "map-row-first" : "", r.essential ? "" : "row-extra"].join(" ").trim() || undefined}>
                  <th scope="row" className="map-first">
                    <RagDot rag={r.rag ?? null} />
                    <Link className="link" href={sessionHref(code, r.year, r.session)}>{r.label}</Link>
                  </th>
                  {v.columns.flatMap((c) => c.types.map((t, i) => (
                    <td key={`${c.paper}-${t}`} className={i === 0 ? "map-start" : undefined}><CellLink cell={r.cells[cellKey(c.paper, t)]} /></td>
                  )))}
                  {tail.map((t, i) => (
                    <td key={t} className={i === 0 ? "map-start" : undefined}>{r.docs ? <CellLink cell={r.docs[t]} /> : null}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="muted">No exam sessions of this syllabus are public yet within the library years.</p>
      )}
      {v.schoolAssessed.length ? (
        <p className="muted">Marked by the school, so no files: {v.schoolAssessed.map((p) => `Paper ${p.paper} ${p.name}`).join(", ")}.</p>
      ) : null}
    </section>
  );
}
