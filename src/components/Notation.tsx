// Text with our notation markup shown as the paper prints it (owner, 9 Nov 2026): ^{...} as a superscript and _{...}
// as a subscript, so ^{208}_{81}Tl reads as the nuclide and H_{2}O as water. Plain React, no HTML strings.
import type { PaperTable } from "@/lib/brain/paper";
import { notationParts } from "@/lib/brain/notation";

export function Notation({ text }: { text: string }) {
  const parts = notationParts(text);
  const out: React.ReactNode[] = [];
  for (let i = 0; i < parts.length; i++) {
    const p = parts[i]!;
    const q = parts[i + 1];
    // A superscript and subscript together (a nuclide's mass and atomic numbers, SO₄²⁻) stack as printed.
    if (p.kind !== "text" && q && q.kind !== "text" && q.kind !== p.kind) {
      const [sup, sub] = p.kind === "sup" ? [p, q] : [q, p];
      out.push(<span key={i} className="nota-stack"><span>{sup.text}</span><span>{sub.text}</span></span>);
      i++;
    } else out.push(p.kind === "sup" ? <sup key={i}>{p.text}</sup> : p.kind === "sub" ? <sub key={i}>{p.text}</sub> : <span key={i}>{p.text}</span>);
  }
  return <>{out}</>;
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
