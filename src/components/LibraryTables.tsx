import Link from "next/link";
import { CellLink } from "@/components/LibraryBits";
import { DOC_TYPE_LABELS } from "@/lib/config";
import type { Cell, PaperRow } from "@/lib/library/checklist";
import { TIER_LABELS, type Paper } from "@/lib/library/papers";

/** Breadcrumb: Library > qualification > subject > ... */
export function Crumbs({ items }: { items: { label: string; href?: string }[] }) {
  return (
    <nav className="crumbs" aria-label="Breadcrumb">
      {items.map((it, i) => (
        <span className="crumb" key={i}>
          {i > 0 ? <span aria-hidden="true">›</span> : null}
          {it.href ? <Link className="link" href={it.href}>{it.label}</Link> : <span aria-current="page">{it.label}</span>}
        </span>
      ))}
    </nav>
  );
}

/** Version-level and session-level documents as labelled chips. */
export function DocChips({ cells }: { cells: Cell[] }) {
  if (cells.length === 0) return null;
  return (
    <div className="doc-chips">
      {cells.map((c) => (
        <CellLink key={c.fileName} cell={c} label={`${DOC_TYPE_LABELS[c.docType]}${c.essential ? "" : " (extra)"}`} />
      ))}
    </div>
  );
}

/** Papers with their names and tiers, one row per paper (and variant), cells per document type. */
export function PaperTable({ rows, types, papers, caption }: { rows: PaperRow[]; types: string[]; papers: Map<number, Paper>; caption?: string }) {
  if (rows.length === 0) return null;
  const heads: Record<string, string> = { qp: "QP", in: "Insert", ms: "MS", ci: "CI", sp: "QP", sm: "MS", pm: "Pre-release", qr: "Transcript" };
  // Only the columns this syllabus uses (no CI column for a subject without practicals).
  types = types.filter((t) => rows.some((r) => r.cells[t as keyof PaperRow["cells"]]));
  return (
    <table className="grid-table">
      {caption ? <caption className="table-caption">{caption}</caption> : null}
      <thead>
        <tr>
          <th scope="col">Paper</th>
          {types.map((t) => (
            <th scope="col" key={t}><abbr title={DOC_TYPE_LABELS[t]}>{heads[t] ?? t.toUpperCase()}</abbr></th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => {
          const p = papers.get(r.paper);
          return (
            <tr key={`${r.paper}-${r.variant}`} className={r.essential ? undefined : "row-extra"}>
              <th scope="row">
                <span className="paper-no">
                  Paper {r.paper}
                  {r.variant ? <span className="muted"> · v{r.variant}</span> : null}
                </span>
                {p ? (
                  <span className="paper-name">
                    {p.name}
                    {p.tier !== "all" ? <span className={`tag tag-${p.tier}`}>{TIER_LABELS[p.tier]}</span> : null}
                  </span>
                ) : null}
              </th>
              {types.map((t) => (
                <td key={t}><CellLink cell={r.cells[t as keyof PaperRow["cells"]]} /></td>
              ))}
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

export function Legend() {
  return (
    <ul className="legend muted" aria-label="Key">
      <li className="legend-item"><span className="cell cell-have" aria-hidden="true">✓</span> Stored (click to review it beside the PDF, or download)</li>
      <li className="legend-item"><span className="cell cell-miss" aria-hidden="true">✕</span> Essential, missing</li>
      <li className="legend-item"><span className="cell cell-extra" aria-hidden="true">+</span> Extra, not stored</li>
      <li className="legend-item">Click a missing file to add it.</li>
    </ul>
  );
}
