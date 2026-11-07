"use client";
// The paper rebuilt from our database beside the PDF (owner, 6 Nov 2026, mockup agreed): one page bar turns both;
// each question part laid out like the paper (number, wording, options, figures, answer lines, [marks]); open flags
// boxed in red (wording), amber (numbers or marks) or blue (our own drawing), each with its fixes. "Next flag" jumps
// to the next one; "Show flags" hides them to read the page plainly. Fixes post in the background (ActionForm).
import { useMemo, useState } from "react";
import { ActionForm } from "@/components/ActionForm";
import type { Flag, PaperItem } from "@/lib/brain/paper";

export type ReviewFigure = { id: string; page: number; caption: string; drawn: boolean };

type Props = {
  docId: string;
  pdfUrl: string;
  kind: "qp" | "ms";
  items: PaperItem[];
  figures: ReviewFigure[];
  flags: Flag[];
  pageCount: number;
  revision: number;
  busy: boolean;
};

const MESSAGES = {
  ok_fixed: "Fixed.",
  still_flagged: "Saved, but it is still not found in the PDF. Check it, or press It's fine.",
  ok_undone: "Undone.",
  ok_started: "Started. Progress shows at the top.",
  running: "A brain run is already going. Wait for it to finish.",
  over_cap: "Not started: this would pass your monthly spending cap.",
  no_price: "Not started: a model in use has no price (AI setup page).",
  busy: "Too many runs this hour. Please wait a little.",
  not_set_up: "Starting runs is not set up yet (GITHUB_TOKEN).",
  github: "GitHub refused to start the run.",
  not_read: "This paper has not been read yet.",
  bad: "That did not work. Please reload the page and try again.",
};

const COLOUR_WORDS = { red: "Wording", amber: "Numbers or marks", blue: "Our drawing" } as const;

export function PaperReview({ docId, pdfUrl, kind, items, figures, flags, pageCount, revision, busy }: Props) {
  const pages = useMemo(() => {
    const set = new Set<number>([...items.map((i) => i.page), ...figures.map((f) => f.page)]);
    return Math.max(pageCount, ...set, 1);
  }, [items, figures, pageCount]);
  const firstPage = useMemo(() => Math.min(...items.map((i) => i.page), pages), [items, pages]);
  const [page, setPage] = useState(firstPage);
  const [show, setShow] = useState(true);
  const byItem = useMemo(() => {
    const m = new Map<string, Flag[]>();
    for (const f of flags) m.set(f.item, [...(m.get(f.item) ?? []), f]);
    return m;
  }, [flags]);
  const figPage = new Map(figures.map((f) => [f.id, f.page]));
  const itemPage = new Map(items.map((i) => [i.number, i.page]));
  const flagPages = flags.map((f) => itemPage.get(f.item) ?? figPage.get(f.item) ?? 0).filter((p) => p > 0).sort((a, b) => a - b);
  const paperFlags = flags.filter((f) => f.item === "paper" || f.kind === "missing");
  const onPage = items.filter((i) => i.page === page);
  const go = (p: number) => setPage(Math.min(pages, Math.max(1, p)));
  const nextFlag = () => {
    const next = flagPages.find((p) => p > page) ?? flagPages[0];
    if (next) {
      setShow(true);
      go(next);
    }
  };
  const base = `/admin/library/review/${encodeURIComponent(docId)}`;

  return (
    <>
      <div className="page-bar">
        <div className="row-actions">
          <button className="btn btn-small" type="button" onClick={() => go(page - 1)} disabled={page <= 1}>Previous page</button>
          <span className="page-bar-count">Page {page} of {pages}</span>
          <button className="btn btn-small" type="button" onClick={() => go(page + 1)} disabled={page >= pages}>Next page</button>
        </div>
        <div className="row-actions">
          <span className="muted">{flags.length} open flag{flags.length === 1 ? "" : "s"}</span>
          <button className="btn btn-small" type="button" onClick={nextFlag} disabled={!flagPages.length}>Next flag</button>
          <label className="check-inline"><input type="checkbox" checked={show} onChange={(e) => setShow(e.target.checked)} /> Show flags</label>
        </div>
      </div>
      <div className="review">
        <section className="review-pane" aria-label="The PDF as stored">
          <h2 className="review-head">The PDF as stored</h2>
          <iframe key={page} className="review-pdf" src={`${pdfUrl}#page=${page}`} title={`The PDF as stored, page ${page}`} />
        </section>
        <section className="review-pane" aria-label="Rebuilt from our database">
          <h2 className="review-head">Rebuilt from our database</h2>
          <div className="review-body paper-sheet" id="paper-sheet">
            {show && paperFlags.length ? (
              <div className="stack-tight">
                {paperFlags.map((f) => <FlagBox key={f.key} flag={f} base={base} busy={busy} item={undefined} />)}
              </div>
            ) : null}
            {onPage.length ? onPage.map((it) => {
              const fl = show ? (byItem.get(it.number) ?? []).filter((f) => f.kind !== "missing") : [];
              const colour = fl.find((f) => f.colour === "red")?.colour ?? fl[0]?.colour;
              return (
                <article key={it.number} className={`pq${colour ? ` pq-flag pq-${colour}` : ""}`} id={`item-${it.number}`}>
                  <div className="pq-row">
                    <span className="pq-num">{it.number}</span>
                    <div className="pq-main">
                      {it.text ? <p className="pq-text">{it.text}</p> : null}
                      {it.options.length ? (
                        <ol className="pq-options">
                          {it.options.map((o) => <li key={o.letter}><span className="pq-letter">{o.letter}</span> {o.text}</li>)}
                        </ol>
                      ) : null}
                      {it.figures.map((id) => {
                        const f = figures.find((x) => x.id === id);
                        const ff = show ? byItem.get(id) ?? [] : [];
                        return (
                          <figure key={id} className={`pq-figure${ff.length ? " pq-flag pq-blue" : ""}`} id={`figure-${id}`}>
                            {f?.drawn ? <img src={`${base}/figure/${encodeURIComponent(id)}?r=${revision}`} alt={`Figure ${id}, our own drawing${f.caption ? `: ${f.caption}` : ""}`} /> : <p className="muted">Figure {id} is not drawn yet.</p>}
                            <figcaption className="muted">{f?.caption || `Figure ${id}`}</figcaption>
                            {ff.map((x) => <FlagBox key={x.key} flag={x} base={base} busy={busy} item={undefined} />)}
                          </figure>
                        );
                      })}
                      {it.answerLines > 0 ? <div className="pq-lines" aria-label={`${it.answerLines} answer lines`}>{Array.from({ length: Math.min(it.answerLines, 12) }, (_, i) => <span key={i} />)}</div> : null}
                      {kind === "ms" && it.guidance ? <p className="pq-guidance"><strong>Guidance:</strong> {it.guidance}</p> : null}
                    </div>
                    <span className="pq-marks">{it.marks !== null ? `[${it.marks}]` : ""}</span>
                  </div>
                  {fl.map((f) => <FlagBox key={f.key} flag={f} base={base} busy={busy} item={it} />)}
                </article>
              );
            }) : <p className="muted">Nothing from our reading on this page (a cover, blank or instructions page).</p>}
          </div>
        </section>
      </div>
    </>
  );
}

/** One open flag: its colour and reason, and the fixes that fit it. */
function FlagBox({ flag, base, busy, item }: { flag: Flag; base: string; busy: boolean; item: PaperItem | undefined }) {
  const fix = `${base}/fix`;
  const isItem = flag.item !== "paper" && flag.kind !== "figure" && flag.kind !== "missing";
  return (
    <div className={`flag-box flag-${flag.colour}`} data-flag={flag.key}>
      <p className="flag-reason"><span className="flag-tag">{COLOUR_WORDS[flag.colour]}</span> {flag.reason}</p>
      {flag.pdfText && isItem ? <p className="flag-pdf"><span className="muted">The PDF says:</span> {flag.pdfText}</p> : null}
      <div className="row-actions">
        {flag.kind === "figure" ? (
          <>
            <ActionForm action={fix} messages={MESSAGES}>
              <input type="hidden" name="action" value="looks_right" />
              <input type="hidden" name="key" value={flag.key} />
              <button className="btn btn-small" type="submit">Looks right</button>
            </ActionForm>
            <ActionForm action={`${base}/read`} messages={MESSAGES}>
              <input type="hidden" name="figure" value={flag.item} />
              <button className="btn btn-small" type="submit" disabled={busy}>Redraw</button>
            </ActionForm>
          </>
        ) : (
          <>
            {flag.pdfText && isItem ? (
              <ActionForm action={fix} messages={MESSAGES}>
                <input type="hidden" name="action" value="pdf" />
                <input type="hidden" name="key" value={flag.key} />
                <button className="btn btn-small" type="submit">Use the PDF&apos;s version</button>
              </ActionForm>
            ) : null}
            {flag.item !== "paper" ? (
              <ActionForm action={`${base}/read`} messages={MESSAGES}>
                <input type="hidden" name="item" value={flag.item} />
                <button className="btn btn-small" type="submit" disabled={busy}>Read it again</button>
              </ActionForm>
            ) : null}
            <ActionForm action={fix} messages={MESSAGES}>
              <input type="hidden" name="action" value="fine" />
              <input type="hidden" name="key" value={flag.key} />
              <button className="btn btn-small" type="submit">It&apos;s fine</button>
            </ActionForm>
          </>
        )}
      </div>
      {item && isItem ? (
        <details className="flag-edit">
          <summary className="link">Edit it yourself</summary>
          <ActionForm className="stack-tight" action={fix} messages={MESSAGES}>
            <input type="hidden" name="action" value="edit" />
            <input type="hidden" name="item" value={item.number} />
            <label className="field">
              <span className="label-inline">Wording of {item.number}</span>
              <textarea className="input" name="text" rows={4} defaultValue={item.text} />
            </label>
            <label className="field">
              <span className="label-inline">Marks</span>
              <input className="input input-money" name="marks" inputMode="numeric" defaultValue={item.marks ?? ""} />
            </label>
            <button className="btn btn-small btn-primary" type="submit">Save and check against the PDF</button>
          </ActionForm>
        </details>
      ) : null}
    </div>
  );
}
