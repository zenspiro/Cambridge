// Text with our notation markup shown as the paper prints it (owner, 9 Nov 2026): ^{...} as a superscript, _{...} as
// a subscript, \frac{...}{...} as a stacked fraction, so ^{208}_{81}Tl reads as the nuclide, H_{2}O as water and
// \frac{4}{x − 1} as four over x − 1, \binom{8}{−5} as a column vector. Plain React, no HTML strings.
import type { ReactNode } from "react";
import type { PaperTable } from "@/lib/brain/paper";
import { notationPlain, notationTree, type NotationNode } from "@/lib/brain/notation";

function render(nodes: readonly NotationNode[]): ReactNode[] {
  const out: ReactNode[] = [];
  for (let i = 0; i < nodes.length; i++) {
    const p = nodes[i]!;
    const q = nodes[i + 1];
    if (p.kind === "text") out.push(<span key={i}>{p.text}</span>);
    else if (p.kind === "frac") {
      out.push(
        <span key={i} className="nota-frac" role="math" aria-label={notationPlain(`\\frac{${plain(p.num)}}{${plain(p.den)}}`)}>
          <span className="nota-num" aria-hidden="true">{render(p.num)}</span>
          <span className="nota-den" aria-hidden="true">{render(p.den)}</span>
        </span>,
      );
    } else if (p.kind === "arrow") {
      out.push(<span key={i} className="nota-arrow" role="math" aria-label={`vector ${notationPlain(plain(p.children))}`}><span aria-hidden="true">{render(p.children)}</span></span>);
    } else if (p.kind === "vec") {
      out.push(
        <span key={i} className="nota-vec" role="math" aria-label={`column vector ${notationPlain(plain(p.top))}, ${notationPlain(plain(p.bottom))}`}>
          <span aria-hidden="true">{render(p.top)}</span>
          <span aria-hidden="true">{render(p.bottom)}</span>
        </span>,
      );
    } else if (q && q.kind !== "text" && q.kind !== "frac" && q.kind !== "vec" && q.kind !== "arrow" && q.kind !== p.kind) {
      // A superscript and subscript together (a nuclide's mass and atomic numbers, SO₄²⁻) stack as printed.
      const [sup, sub] = p.kind === "sup" ? [p, q] : [q, p];
      out.push(<span key={i} className="nota-stack"><span>{render(sup.children)}</span><span>{render(sub.children)}</span></span>);
      i++;
    } else out.push(p.kind === "sup" ? <sup key={i}>{render(p.children)}</sup> : <sub key={i}>{render(p.children)}</sub>);
  }
  return out;
}

/** A node list back to its markup (for a fraction's spoken label). */
function plain(nodes: readonly NotationNode[]): string {
  return nodes.map((n) => (n.kind === "text" ? n.text : n.kind === "frac" ? `\\frac{${plain(n.num)}}{${plain(n.den)}}` : n.kind === "vec" ? `\\binom{${plain(n.top)}}{${plain(n.bottom)}}` : n.kind === "arrow" ? `\\vec{${plain(n.children)}}` : `${n.kind === "sup" ? "^" : "_"}{${plain(n.children)}}`)).join("");
}

export function Notation({ text }: { text: string }) {
  return <>{render(notationTree(text))}</>;
}

/** A question's tables as real tables: the first row as headings, an empty cell (to fill in) shown as a blank box. */
export function PaperTables({ tables }: { tables: readonly PaperTable[] }) {
  if (!tables.length) return null;
  return (
    <>
      {tables.map((t, ti) => (
        <figure key={ti} className="pq-table">
          {t.label ? <figcaption>{t.label}</figcaption> : null}
          <table className="table">
            <thead>
              <tr>{(t.rows[0] ?? []).map((c, ci) => <th key={ci} scope="col"><Notation text={c} /></th>)}</tr>
            </thead>
            <tbody>
              {t.rows.slice(1).map((r, ri) => (
                <tr key={ri}>{r.map((c, ci) => <td key={ci} className={c ? undefined : "pq-cell-blank"}>{c ? <Notation text={c} /> : <span className="sr-only">blank to fill in</span>}</td>)}</tr>
              ))}
            </tbody>
          </table>
        </figure>
      ))}
    </>
  );
}
