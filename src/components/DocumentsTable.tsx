// The Documents table (owner, 10 Nov 2026): every stored file with its own filter per column, sorted by a heading,
// 50 to a page. A plain GET form, so a filtered view is an address to keep or send; works without scripts.
import { SESSION_LABELS } from "@/lib/config";
import { ScoreBadge } from "@/components/ScoreBadge";
import { facet, filterDocs, PAGE_SIZE, REVIEW_WORDS, SCORE_WORDS, sortDocs, type DocFilter, type DocRow, type DocSort } from "@/lib/library/documents";

const dateWords = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
const STATUS_PILL: Record<DocRow["status"], string> = {
  needs: "pill-bad", reviewed: "pill-ok", ready: "pill-info", override: "pill-warn", unread: "pill-muted", unreadable: "pill-muted",
};

/** The filter as address values; `with` changes some of them (a sort, a page). */
export function filterQuery(f: DocFilter, change: Partial<DocFilter> = {}): string {
  const g = { ...f, ...change };
  const q = new URLSearchParams();
  const lists: (keyof DocFilter)[] = ["subject", "year", "month", "type", "paper", "format", "tier", "variant", "ai", "status", "by"];
  for (const k of lists) for (const v of g[k] as string[]) q.append(k, v);
  for (const k of ["flags", "from", "to", "q"] as const) if (g[k]) q.set(k, g[k]);
  if (g.sort !== "score") q.set("sort", g.sort);
  q.set("dir", g.dir);
  if (g.page > 1) q.set("page", String(g.page));
  return q.toString();
}

type Col = { key: string; label: string; sort?: DocSort; options?: { value: string; label: string; n: number }[]; name?: keyof DocFilter };

export function DocumentsTable({ rows, filter, base, showSubject }: { rows: DocRow[]; filter: DocFilter; base: string; showSubject: boolean }) {
  const shown = sortDocs(filterDocs(rows, filter), filter.sort, filter.dir);
  const pages = Math.max(1, Math.ceil(shown.length / PAGE_SIZE));
  const page = Math.min(filter.page, pages);
  const slice = shown.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  const order = (a: { value: string; label: string }, b: { value: string; label: string }) => a.label.localeCompare(b.label, "en", { numeric: true });
  const cols: Col[] = [
    ...(showSubject ? [{ key: "subject", label: "Subject", sort: "subject" as const, name: "subject" as const, options: facet(rows, (r) => r.code, (_v, r) => r.subject).sort(order) }] : []),
    { key: "year", label: "Year", sort: "year", name: "year", options: facet(rows, (r) => String(r.year), (v) => v).sort((a, b) => b.value.localeCompare(a.value)) },
    { key: "month", label: "Month", name: "month", options: facet(rows, (r) => r.session, (v) => SESSION_LABELS[v] ?? v).sort((a, b) => "ymsw".indexOf(a.value) - "ymsw".indexOf(b.value)) },
    { key: "type", label: "Type", sort: "type", name: "type", options: facet(rows, (r) => r.type, (_v, r) => r.typeLabel).sort(order) },
    { key: "paper", label: "Paper", sort: "paper", name: "paper", options: facet(rows, (r) => (r.paper ? String(r.paper) : ""), (v, r) => (v ? r.paperName : "No paper (whole session)")).sort(order) },
    { key: "format", label: "Format", name: "format", options: facet(rows, (r) => r.format, (v) => v || "None").sort(order) },
    { key: "tier", label: "Tier", name: "tier", options: facet(rows, (r) => r.tier, (v) => v || "None").sort(order) },
    { key: "variant", label: "Variant", name: "variant", options: facet(rows, (r) => (r.variant === null ? "none" : String(r.variant)), (v) => (v === "none" ? "None" : v)).sort(order) },
    { key: "ai", label: "AI score", sort: "score", name: "ai", options: facet(rows, (r) => r.score?.colour ?? "none", (v) => SCORE_WORDS[v as keyof typeof SCORE_WORDS]) },
    { key: "status", label: "Review status", sort: "status", name: "status", options: facet(rows, (r) => r.status, (v) => REVIEW_WORDS[v as DocRow["status"]]) },
    { key: "flags", label: "Flags open", sort: "flags" },
    { key: "by", label: "Last reviewed by", sort: "reviewed", name: "by", options: facet(rows, (r) => r.reviewer || "nobody", (v, r) => (v === "nobody" ? "Nobody yet" : r.reviewerName)).sort(order) },
    { key: "read", label: "Last read", sort: "read" },
  ];
  const sortHref = (s: DocSort) => `${base}?${filterQuery(filter, { sort: s, dir: filter.sort === s && filter.dir === "asc" ? "desc" : "asc", page: 1 })}#documents`;
  const pageHref = (p: number) => `${base}?${filterQuery(filter, { page: p })}#documents`;
  const active = (["subject", "year", "month", "type", "paper", "format", "tier", "variant", "ai", "status", "by"] as const).reduce((n, k) => n + filter[k].length, 0)
    + (filter.flags ? 1 : 0) + (filter.from ? 1 : 0) + (filter.to ? 1 : 0) + (filter.q ? 1 : 0);

  return (
    <form className="card stack docs" method="get" action={`${base}#documents`} id="documents">
      <div className="docs-bar">
        <label className="field field-search">
          <span className="sr-only">Search the documents</span>
          <input className="input" type="search" name="q" maxLength={100} defaultValue={filter.q} placeholder="Search, e.g. Nov 2025 paper 4 mark scheme" />
        </label>
        <label className="field">
          <span className="label-inline">Read from</span>
          <input className="input" type="date" name="from" defaultValue={filter.from} />
        </label>
        <label className="field">
          <span className="label-inline">to</span>
          <input className="input" type="date" name="to" defaultValue={filter.to} />
        </label>
        <input type="hidden" name="sort" value={filter.sort} />
        <input type="hidden" name="dir" value={filter.dir} />
        <button className="btn btn-primary" type="submit">Apply filters</button>
        {active ? <a className="btn" href={`${base}#documents`}>Clear filters ({active})</a> : null}
        <span className="muted docs-count" aria-live="polite">{shown.length} of {rows.length} shown</span>
      </div>
      <div>
        <table className="table docs-table">
          <thead>
            <tr>
              {cols.map((c) => (
                <th key={c.key} scope="col" aria-sort={c.sort && filter.sort === c.sort ? (filter.dir === "asc" ? "ascending" : "descending") : undefined}>
                  {c.sort ? <a className="link docs-sort" href={sortHref(c.sort)}>{c.label}{filter.sort === c.sort ? (filter.dir === "asc" ? " ▲" : " ▼") : ""}</a> : c.label}
                </th>
              ))}
              <th scope="col"><span className="sr-only">Open</span></th>
            </tr>
            <tr className="docs-filters">
              {cols.map((c) => (
                <td key={c.key}>
                  {c.name && c.options ? (() => {
                    const name = c.name;
                    const chosen = filter[name] as string[];
                    return (
                    <details className="col-filter">
                      <summary aria-label={`Filter ${c.label}`}>{chosen.length ? `${chosen.length} chosen` : "All"}</summary>
                      <div className="col-filter-box">
                        {c.options.map((o) => (
                          <label key={o.value} className="check-inline">
                            <input type="checkbox" name={name} value={o.value} defaultChecked={chosen.includes(o.value)} />
                            {o.label} <span className="muted">({o.n})</span>
                          </label>
                        ))}
                        <button className="btn btn-small" type="submit">Apply</button>
                      </div>
                    </details>
                    );
                  })() : c.key === "flags" ? (
                    <select className="input input-compact" name="flags" defaultValue={filter.flags} aria-label="Flags open">
                      <option value="">All</option>
                      <option value="1">1 or more</option>
                      <option value="0">None</option>
                    </select>
                  ) : null}
                </td>
              ))}
              <td />
            </tr>
          </thead>
          <tbody>
            {slice.map((r) => (
              <tr key={r.id}>
                {showSubject ? <td>{r.subject}</td> : null}
                <td>{r.year}</td>
                <td>{SESSION_LABELS[r.session] ?? r.session}</td>
                <td>{r.typeLabel}</td>
                <td>{r.paperName}</td>
                <td>{r.format}</td>
                <td>{r.tier}</td>
                <td>{r.variant ?? ""}</td>
                <td>{r.score ? <span title={r.models ? `First read by ${r.models}` : undefined}><ScoreBadge score={r.score} /></span> : <span className="muted docs-none">Not read</span>}</td>
                <td><span className={`pill ${STATUS_PILL[r.status]}`}>{REVIEW_WORDS[r.status]}</span></td>
                <td>{r.readAt !== null ? r.open : ""}</td>
                <td>{r.reviewerName ? <>{r.reviewerName}<span className="muted">, {dateWords.format(r.reviewedAt ?? 0)}</span></> : ""}</td>
                <td>{r.readAt !== null ? dateWords.format(r.readAt) : ""}</td>
                {/* A full page load: the review page's own security policy frames the PDF. */}
                <td><a className="btn btn-small" href={`/admin/library/review/${encodeURIComponent(r.id)}`}>{r.status === "unread" || r.status === "unreadable" ? "Open" : "Review"}</a></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {!slice.length ? <p className="muted m-0">{rows.length ? "No documents match these filters." : "No documents stored yet."}</p> : null}
      {pages > 1 ? (
        <nav className="docs-pages" aria-label="Pages of documents">
          {page > 1 ? <a className="btn btn-small" href={pageHref(page - 1)}>Previous</a> : null}
          <span>Page {page} of {pages}</span>
          {page < pages ? <a className="btn btn-small" href={pageHref(page + 1)}>Next</a> : null}
        </nav>
      ) : null}
    </form>
  );
}
