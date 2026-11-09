"use client";
// The paper rebuilt from our database beside the PDF (owner, 6 Nov 2026, mockup agreed): one page bar turns both;
// each question part laid out like the paper (number, wording, options, figures, answer lines, [marks]); open flags
// boxed in red (wording), amber (numbers or marks) or blue (a figure's box), each with its fixes. The flag list
// (owner, 7 Nov 2026) shows every open flag by page; a click, Previous / Next or the J and K keys jump to one, and
// after a fix the next one is picked. Figures are cut from the PDF (figures.ts); "Adjust box" draws a figure's box by
// hand on its page. The page and flag you were on are remembered in this browser. Fixes post in the background.
import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { ActionForm } from "@/components/ActionForm";
import { Notation, PaperTables } from "@/components/Notation";
import { isLeadIn, type Flag, type FlagColour, type PaperItem } from "@/lib/brain/paper";
import type { FixView } from "@/lib/brain/paperRead";

export type ReviewFigure = { id: string; page: number; caption: string; description: string; shown: boolean; cut: string };

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
  /** Fixes (source review edit) and Read it again (the owner: paid runs). View-only team members see the flags only. */
  canFix?: boolean;
  canRead?: boolean;
  /** Every change made on the paper, newest first (owner, 9 Nov 2026: each can be opened where it was made). */
  fixes?: FixView[];
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

const COLOUR_WORDS = { red: "Wording", amber: "Numbers or marks", blue: "Figure" } as const;
const FILTERS: readonly ("all" | FlagColour)[] = ["all", "red", "amber", "blue"];
const FILTER_WORDS = { all: "All", red: "Wording", amber: "Numbers or marks", blue: "Figures" } as const;
const CUT_WORDS: Record<string, string> = {
  caption: "Cut from the PDF above its label.", match: "Cut from the PDF by its labels.", order: "Cut from the PDF by position.",
  manual: "Box drawn by hand.", page: "The whole page.",
};

function remembered(docId: string): { page?: number; flag?: string } {
  try {
    const v = JSON.parse(window.localStorage.getItem(`review:${docId}`) ?? "{}") as { page?: unknown; flag?: unknown };
    return { page: typeof v.page === "number" ? v.page : undefined, flag: typeof v.flag === "string" ? v.flag : undefined };
  } catch {
    return {};
  }
}

function remember(docId: string, page: number, flag: string | null) {
  try {
    window.localStorage.setItem(`review:${docId}`, JSON.stringify({ page, flag }));
  } catch {
    // private window or storage off: nothing to keep
  }
}

const dateTime = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "UTC" });

export function PaperReview({ docId, pdfUrl, kind, items, figures, flags, pageCount, revision, busy, canFix = true, canRead = true, fixes = [] }: Props) {
  const pages = useMemo(() => Math.max(pageCount, ...items.map((i) => i.page), ...figures.map((f) => f.page), 1), [items, figures, pageCount]);
  const firstPage = useMemo(() => Math.min(...items.map((i) => i.page), pages), [items, pages]);
  const [page, setPage] = useState(firstPage);
  const [show, setShow] = useState(true);
  const [filter, setFilter] = useState<"all" | FlagColour>("all");
  const [current, setCurrent] = useState<string | null>(null);
  const [listOpen, setListOpen] = useState(true);
  // The panel's lists (owner, 9 Nov 2026): open flags, every page, every change; each row opens its page on both sides.
  const [tab, setTab] = useState<"flags" | "pages" | "changes">(flags.length ? "flags" : "pages");
  const [focus, setFocus] = useState<string | null>(null);
  const [adjusting, setAdjusting] = useState<string | null>(null);
  const closeEditor = useCallback(() => setAdjusting(null), []);
  const lastIndex = useRef(0);
  const restored = useRef(false);

  const itemPage = useMemo(() => new Map(items.map((i) => [i.number, i.page])), [items]);
  const figPage = useMemo(() => new Map(figures.map((f) => [f.id, f.page])), [figures]);
  const order = useMemo(() => new Map([...items.map((i, k) => [i.number, k] as const), ...figures.map((f, k) => [f.id, items.length + k] as const)]), [items, figures]);
  const pageOf = useCallback((f: Flag) => itemPage.get(f.item) ?? figPage.get(f.item) ?? 0, [itemPage, figPage]);
  // Every open flag in paper order: the paper's own first, then by page and position.
  const ordered = useMemo(() => [...flags].sort((a, b) => pageOf(a) - pageOf(b) || (order.get(a.item) ?? -1) - (order.get(b.item) ?? -1) || a.key.localeCompare(b.key)), [flags, pageOf, order]);
  const visible = useMemo(() => ordered.filter((f) => filter === "all" || f.colour === filter), [ordered, filter]);
  const counts = useMemo(() => ({ all: flags.length, red: flags.filter((f) => f.colour === "red").length, amber: flags.filter((f) => f.colour === "amber").length, blue: flags.filter((f) => f.colour === "blue").length }), [flags]);
  const index = current ? visible.findIndex((f) => f.key === current) : -1;

  const go = (p: number) => setPage(Math.min(pages, Math.max(1, p)));
  /** Open a part or figure where it is: both sides turn to its page and it is marked. */
  const openPart = (id: string | null, p?: number) => {
    const at = p ?? (id ? itemPage.get(id) ?? figPage.get(id) : undefined);
    if (at) setPage(at);
    setCurrent(null);
    setFocus(id);
  };
  const select = useCallback((f: Flag | undefined) => {
    if (!f) return;
    setShow(true);
    setCurrent(f.key);
    const p = pageOf(f);
    if (p > 0) setPage(p);
  }, [pageOf]);
  const step = useCallback((by: number) => {
    if (!visible.length) return;
    const i = index < 0 ? (by > 0 ? 0 : visible.length - 1) : (index + by + visible.length) % visible.length;
    select(visible[i]);
  }, [visible, index, select]);

  // The page and flag you were on, from this browser (after the first render, so the server's page matches).
  useEffect(() => {
    if (restored.current) return;
    restored.current = true;
    const r = remembered(docId);
    const f = r.flag ? flags.find((x) => x.key === r.flag) : undefined;
    if (f) select(f);
    else if (r.page && r.page >= 1 && r.page <= pages) setPage(r.page);
  }, [docId, flags, pages, select]);
  useEffect(() => {
    if (restored.current) remember(docId, page, current);
  }, [docId, page, current]);

  // A fix removes its flag: move on to the one that took its place in the list.
  useEffect(() => {
    if (index >= 0) {
      lastIndex.current = index;
      return;
    }
    if (current && visible.length) select(visible[Math.min(lastIndex.current, visible.length - 1)]);
    else if (current && !visible.length) setCurrent(null);
  }, [index, current, visible, select]);

  // Bring a part opened from Pages or Changes into view.
  useEffect(() => {
    if (!focus) return;
    const el = document.getElementById(`item-${focus}`) ?? document.getElementById(`figure-${focus}`);
    el?.scrollIntoView({ block: "center", behavior: "smooth" });
  }, [focus, page]);

  // Bring the chosen flag into view and mark it.
  useEffect(() => {
    if (!current) return;
    const el = document.querySelector(`[data-flag="${CSS.escape(current)}"]`);
    el?.scrollIntoView({ block: "center", behavior: "smooth" });
  }, [current, page]);

  // J / K (and N / P) step through the flags, unless you are typing.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (e.ctrlKey || e.metaKey || e.altKey || document.querySelector(".box-overlay") || (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName)))) return;
      if (e.key === "j" || e.key === "n") step(1);
      else if (e.key === "k" || e.key === "p") step(-1);
      else return;
      e.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [step]);

  const byItem = useMemo(() => {
    const m = new Map<string, Flag[]>();
    for (const f of flags) m.set(f.item, [...(m.get(f.item) ?? []), f]);
    return m;
  }, [flags]);
  const paperFlags = flags.filter((f) => f.item === "paper" || f.kind === "missing");
  const onPage = items.filter((i) => i.page === page);
  const base = `/admin/library/review/${encodeURIComponent(docId)}`;
  const box = (f: Flag, item: PaperItem | undefined) => (
    <FlagBox key={f.key} flag={f} base={base} busy={busy} item={item} current={f.key === current} onAdjust={setAdjusting} canFix={canFix} canRead={canRead} />
  );

  const figureCard = (id: string) => {
    const f = figures.find((x) => x.id === id);
    const ff = show ? byItem.get(id) ?? [] : [];
    return (
      <figure key={id} className={`pq-figure${ff.length ? " pq-flag pq-blue" : ""}${focus === id ? " pq-focus" : ""}`} id={`figure-${id}`}>
        {f?.shown ? <img src={`${base}/figure/${encodeURIComponent(id)}?r=${revision}`} alt={`Figure ${id}${f.caption ? `: ${f.caption}` : ""}`} /> : <p className="muted">Figure {id} has no box yet.</p>}
        <figcaption className="pq-figcaption">
          <span>{f?.caption || `Figure ${id}`}</span>
          {f?.description ? <span className="muted">{f.description}</span> : null}
          <span className="pq-figure-actions">
            <span className="muted">{CUT_WORDS[f?.cut ?? ""] ?? ""}</span>
            {adjusting !== id ? <button className="link" type="button" onClick={() => setAdjusting(id)}>Adjust box</button> : null}
          </span>
        </figcaption>
        {ff.map((x) => box(x, undefined))}
      </figure>
    );
  };
  // Figures no question part points to still show on their page.
  const shownByItems = new Set(items.flatMap((i) => i.figures));
  const loose = figures.filter((f) => f.page === page && !shownByItems.has(f.id));

  return (
    <>
      <div className="page-bar">
        <div className="row-actions">
          <button className="btn btn-small" type="button" onClick={() => go(page - 1)} disabled={page <= 1}>Previous page</button>
          <span className="page-bar-count">Page {page} of {pages}</span>
          <button className="btn btn-small" type="button" onClick={() => go(page + 1)} disabled={page >= pages}>Next page</button>
        </div>
        <div className="row-actions">
          <button className="btn btn-small" type="button" onClick={() => step(-1)} disabled={!visible.length} aria-keyshortcuts="k">Previous flag</button>
          <span className="flag-count" aria-live="polite">{visible.length ? (index >= 0 ? `Flag ${index + 1} of ${visible.length}` : `${visible.length} open flag${visible.length === 1 ? "" : "s"}`) : "No open flags"}</span>
          <button className="btn btn-small" type="button" onClick={() => step(1)} disabled={!visible.length} aria-keyshortcuts="j">Next flag</button>
          <label className="check-inline"><input type="checkbox" checked={show} onChange={(e) => setShow(e.target.checked)} /> Show flags</label>
        </div>
      </div>
      <section className="flag-panel" aria-label="Flags, pages and changes">
        <div className="panel-tabs" role="tablist" aria-label="What to list">
          {([["flags", `Flags (${flags.length})`], ["pages", `Pages (${pages})`], ["changes", `Changes (${fixes.length})`]] as const).map(([k, label]) => (
            <button key={k} type="button" role="tab" className="panel-tab" aria-selected={tab === k} onClick={() => setTab(k)}>{label}</button>
          ))}
        </div>
        {tab === "flags" ? (flags.length ? (
          <>
  <div className="flag-panel-head">
              <div className="flag-filters" role="group" aria-label="Show flags of one kind">
                {FILTERS.map((k) => (
                  <button key={k} type="button" className={`flag-filter flag-filter-${k}`} aria-pressed={filter === k} onClick={() => setFilter(k)} disabled={k !== "all" && !counts[k]}>
                    {FILTER_WORDS[k]} <span className="flag-filter-count">{counts[k]}</span>
                  </button>
                ))}
              </div>
              <span className="muted">Keys: J next, K previous</span>
              <button className="link" type="button" onClick={() => setListOpen(!listOpen)} aria-expanded={listOpen}>{listOpen ? "Hide the list" : "Show the list"}</button>
            </div>
            {listOpen ? (
              <ol className="flag-list">
                {visible.map((f) => (
                  <li key={f.key}>
                    <button type="button" className={`flag-row${f.key === current ? " flag-row-current" : ""}`} aria-current={f.key === current ? "true" : undefined} onClick={() => select(f)}>
                      <span className={`flag-dot flag-dot-${f.colour}`} aria-hidden="true" />
                      <span className="flag-row-item">{f.item === "paper" ? "Whole paper" : f.item}</span>
                      <span className="flag-row-page">{pageOf(f) ? `p. ${pageOf(f)}` : ""}</span>
                      <span className="flag-row-reason">{f.reason}</span>
                    </button>
                  </li>
                ))}
              </ol>
            ) : null}
          </>
        ) : <p className="muted m-0">No open flags.</p>) : null}
        {tab === "pages" ? (
          <ol className="flag-list">
            {Array.from({ length: pages }, (_, k) => k + 1).map((p) => {
              const parts = items.filter((i) => i.page === p).map((i) => i.number);
              const figs = figures.filter((f) => f.page === p).map((f) => f.id);
              const open = flags.filter((f) => pageOf(f) === p).length;
              const changed = fixes.filter((f) => !f.undone && f.item && (itemPage.get(f.item) ?? figPage.get(f.item)) === p).length;
              return (
                <li key={p}>
                  <button type="button" className={`flag-row${p === page ? " flag-row-current" : ""}`} aria-current={p === page ? "page" : undefined} onClick={() => openPart(null, p)}>
                    <span className={`flag-dot ${open ? "flag-dot-amber" : parts.length || figs.length ? "flag-dot-ok" : "flag-dot-none"}`} aria-hidden="true" />
                    <span className="flag-row-item">Page {p}</span>
                    <span className="flag-row-page">{open ? `${open} flag${open === 1 ? "" : "s"}` : ""}</span>
                    <span className="flag-row-reason">
                      {parts.length || figs.length ? [...parts, ...figs].join(", ") : "Nothing from our reading (cover, blank or instructions)"}
                      {changed ? <span className="muted"> ({changed} change{changed === 1 ? "" : "s"})</span> : null}
                    </span>
                  </button>
                </li>
              );
            })}
          </ol>
        ) : null}
        {tab === "changes" ? (fixes.length ? (
          <ol className="flag-list change-list">
            {fixes.map((f) => {
              const p = f.item ? itemPage.get(f.item) ?? figPage.get(f.item) : undefined;
              return (
                <li key={f.id} className={f.undone ? "change-undone" : undefined} data-fix={f.id}>
                  <div className="change-row">
                    {p ? (
                      <button type="button" className="flag-row" onClick={() => openPart(f.item, p)}>
                        <span className={`flag-dot ${f.undone ? "flag-dot-none" : "flag-dot-blue"}`} aria-hidden="true" />
                        <span className="flag-row-item">{f.item}</span>
                        <span className="flag-row-page">p. {p}</span>
                        <span className="flag-row-reason">{f.what}</span>
                      </button>
                    ) : <span className="flag-row"><span className={`flag-dot ${f.undone ? "flag-dot-none" : "flag-dot-blue"}`} aria-hidden="true" /><span className="flag-row-item">{f.item ?? "Paper"}</span><span /><span className="flag-row-reason">{f.what}</span></span>}
                    <span className="muted change-meta">{f.who}, {dateTime.format(f.at)} UTC{f.undone ? " (undone)" : ""}</span>
                    {!f.undone && canFix ? (
                      <ActionForm className="inline-form fix-undo" action={`${base}/fix`} messages={MESSAGES}>
                        <input type="hidden" name="action" value="undo" />
                        <input type="hidden" name="fix" value={f.id} />
                        <button className="btn btn-small" type="submit">Undo</button>
                      </ActionForm>
                    ) : null}
                  </div>
                  {f.before || f.after ? (
                    <div className="change-diff">
                      {f.before ? <p className="m-0"><span className="muted">Before:</span> <Notation text={f.before} /></p> : null}
                      {f.after ? <p className="m-0"><span className="muted">After:</span> <Notation text={f.after} /></p> : null}
                    </div>
                  ) : null}
                </li>
              );
            })}
          </ol>
        ) : <p className="muted m-0">No changes yet. Every fix made here is listed, with a link to where it was made.</p>) : null}
      </section>
      <div className="review">
        <section className="review-pane" aria-label="The PDF as stored">
          <h2 className="review-head">The PDF as stored</h2>
          <iframe key={page} className="review-pdf" src={`${pdfUrl}#page=${page}`} title={`The PDF as stored, page ${page}`} />
        </section>
        <section className="review-pane" aria-label="Rebuilt from our database">
          <h2 className="review-head">Rebuilt from our database</h2>
          <div className="review-body paper-sheet" id="paper-sheet">
            {show && paperFlags.length ? <div className="stack-tight">{paperFlags.map((f) => box(f, undefined))}</div> : null}
            {onPage.length ? onPage.map((it) => {
              const fl = show ? (byItem.get(it.number) ?? []).filter((f) => f.kind !== "missing") : [];
              const colour = fl.find((f) => f.colour === "red")?.colour ?? fl[0]?.colour;
              return (
                <article key={it.number} className={`pq${isLeadIn(items, it.number) ? " pq-lead" : ""}${colour ? ` pq-flag pq-${colour}` : ""}${focus === it.number ? " pq-focus" : ""}`} id={`item-${it.number}`}>
                  <div className="pq-row">
                    <span className="pq-num">{it.number}</span>
                    <div className="pq-main">
                      {it.text ? <p className="pq-text"><Notation text={it.text} /></p> : null}
                      <PaperTables tables={it.tables ?? []} />
                      {it.options.length ? (
                        <ol className="pq-options">
                          {it.options.map((o) => <li key={o.letter}><span className="pq-letter">{o.letter}</span> <Notation text={o.text} /></li>)}
                        </ol>
                      ) : null}
                      {it.figures.map(figureCard)}
                      {it.answerLines > 0 ? <div className="pq-lines" aria-label={`${it.answerLines} answer lines`}>{Array.from({ length: Math.min(it.answerLines, 12) }, (_, i) => <span key={i} />)}</div> : null}
                      {kind === "ms" && it.guidance ? <p className="pq-guidance"><strong>Guidance:</strong> <Notation text={it.guidance} /></p> : null}
                    </div>
                    <span className="pq-marks">{it.marks !== null ? `[${it.marks}]` : ""}</span>
                  </div>
                  {fl.map((f) => box(f, it))}
                </article>
              );
            }) : null}
            {loose.map((f) => figureCard(f.id))}
            {!onPage.length && !loose.length ? <p className="muted">Nothing from our reading on this page (a cover, blank or instructions page).</p> : null}
          </div>
        </section>
      </div>
      {adjusting ? <BoxEditor base={base} figure={adjusting} revision={revision} onClose={closeEditor} /> : null}
    </>
  );
}

/**
 * Draws a figure's box by hand on its whole page, in a large panel over the review screen (owner, 7 Nov 2026: opened
 * inside the narrow figure column it was out of sight and too small). The current box is framed in red; press and
 * drag on the page, then Save this box. "Use whole page" takes the printed page. Coordinates are the PDF's points,
 * from the page SVG. A save changes the paper's revision, which closes the panel; Escape or Cancel close it too.
 */
function BoxEditor({ base, figure, revision, onClose }: { base: string; figure: string; revision: number; onClose: () => void }) {
  const [page, setPage] = useState<{ url: string; w: number; h: number } | null>(null);
  const [failed, setFailed] = useState(false);
  const [drag, setDrag] = useState<{ x0: number; y0: number; x1: number; y1: number } | null>(null);
  const down = useRef(false);
  const svg = useRef<SVGSVGElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const opened = useRef(revision);

  // Saved (the paper's revision moved on): close. Escape closes too.
  useEffect(() => {
    if (revision !== opened.current) onClose();
  }, [revision, onClose]);
  useEffect(() => {
    panel.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  useEffect(() => {
    let url = "";
    let stop = false;
    (async () => {
      try {
        const r = await fetch(`${base}/figure/${encodeURIComponent(figure)}/page?r=${revision}`, { cache: "no-store" });
        if (!r.ok) throw new Error(String(r.status));
        const text = await r.text();
        const vb = text.match(/viewBox="([-\d.]+) ([-\d.]+) ([\d.]+) ([\d.]+)"/);
        if (!vb) throw new Error("no viewBox");
        url = URL.createObjectURL(new Blob([text], { type: "image/svg+xml" }));
        if (!stop) setPage({ url, w: Number(vb[3]), h: Number(vb[4]) });
      } catch {
        if (!stop) setFailed(true);
      }
    })();
    return () => {
      stop = true;
      if (url) URL.revokeObjectURL(url);
    };
  }, [base, figure, revision]);

  const point = (e: ReactPointerEvent<SVGSVGElement>) => {
    const m = svg.current?.getScreenCTM();
    if (!svg.current || !m) return null;
    const p = new DOMPoint(e.clientX, e.clientY).matrixTransform(m.inverse());
    return { x: Math.round(p.x * 10) / 10, y: Math.round(p.y * 10) / 10 };
  };
  const box: [number, number, number, number] | null = drag ? [Math.min(drag.x0, drag.x1), Math.min(drag.y0, drag.y1), Math.max(drag.x0, drag.x1), Math.max(drag.y0, drag.y1)] : null;
  const ready = box && box[2] - box[0] >= 8 && box[3] - box[1] >= 8;

  return (
    <div className="box-overlay" role="dialog" aria-modal="true" aria-label={`Draw the box of figure ${figure}`}>
      <div className="box-panel" ref={panel} tabIndex={-1}>
        <div className="box-panel-head">
          <div>
            <h2 className="subtitle m-0">Figure {figure}: draw its box</h2>
            <p className="muted m-0">{failed ? "This page's drawing is not stored yet. Read the paper again to cut its figures, then adjust the box." : "Press and drag on the page around the figure. The red frame is its box now; yours shows in blue."}</p>
          </div>
          <div className="row-actions">
            <ActionForm action={`${base}/fix`} messages={MESSAGES}>
              <input type="hidden" name="action" value="box" />
              <input type="hidden" name="item" value={figure} />
              <input type="hidden" name="box" value={box ? box.join(",") : ""} />
              <button className="btn btn-small btn-primary" type="submit" disabled={!ready}>Save this box</button>
            </ActionForm>
            <ActionForm action={`${base}/fix`} messages={MESSAGES}>
              <input type="hidden" name="action" value="box" />
              <input type="hidden" name="item" value={figure} />
              <input type="hidden" name="box" value="whole" />
              <button className="btn btn-small" type="submit" disabled={failed}>Use whole page</button>
            </ActionForm>
            <button className="btn btn-small" type="button" onClick={onClose}>Cancel</button>
          </div>
        </div>
        {page ? (
          <svg
            ref={svg}
            className="box-editor-page"
            viewBox={`0 0 ${page.w} ${page.h}`}
            role="img"
            aria-label={`The page of figure ${figure}. Drag to draw its box.`}
            onPointerDown={(e) => {
              const p = point(e);
              if (!p) return;
              down.current = true;
              e.currentTarget.setPointerCapture(e.pointerId);
              setDrag({ x0: p.x, y0: p.y, x1: p.x, y1: p.y });
            }}
            onPointerMove={(e) => {
              if (!down.current) return;
              const p = point(e);
              if (p) setDrag((d) => (d ? { ...d, x1: p.x, y1: p.y } : d));
            }}
            onPointerUp={() => { down.current = false; }}
          >
            <image href={page.url} x="0" y="0" width={page.w} height={page.h} />
            {box ? <rect className="box-editor-new" x={box[0]} y={box[1]} width={box[2] - box[0]} height={box[3] - box[1]} /> : null}
          </svg>
        ) : failed ? null : <p className="muted">Loading the page...</p>}
      </div>
    </div>
  );
}

/** One open flag: its colour and reason, and the fixes that fit it. */
function FlagBox({ flag, base, busy, item, current, onAdjust, canFix, canRead }: { flag: Flag; base: string; busy: boolean; item: PaperItem | undefined; current: boolean; onAdjust: (id: string) => void; canFix: boolean; canRead: boolean }) {
  const fix = `${base}/fix`;
  const isItem = flag.item !== "paper" && flag.kind !== "figure" && flag.kind !== "missing";
  return (
    <div className={`flag-box flag-${flag.colour}${current ? " flag-current" : ""}`} data-flag={flag.key}>
      <p className="flag-reason"><span className="flag-tag">{COLOUR_WORDS[flag.colour]}</span> {flag.reason}</p>
      {flag.pdfText && isItem ? <p className="flag-pdf"><span className="muted">{flag.kind === "structure" ? "The paper's lead-in:" : "The PDF says:"}</span> <Notation text={flag.pdfText} /></p> : null}
      {canFix ? <div className="row-actions">
        {flag.kind === "figure" ? (
          <>
            <ActionForm action={fix} messages={MESSAGES}>
              <input type="hidden" name="action" value="looks_right" />
              <input type="hidden" name="key" value={flag.key} />
              <button className="btn btn-small" type="submit">Looks right</button>
            </ActionForm>
            <button className="btn btn-small" type="button" onClick={() => onAdjust(flag.item)}>Adjust box</button>
          </>
        ) : (
          <>
            {flag.pdfText && isItem ? (
              <ActionForm action={fix} messages={MESSAGES}>
                <input type="hidden" name="action" value="pdf" />
                <input type="hidden" name="key" value={flag.key} />
                <button className="btn btn-small" type="submit">{flag.kind === "structure" ? "Give it its own part" : "Use the PDF's version"}</button>
              </ActionForm>
            ) : null}
            {flag.item !== "paper" && canRead ? (
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
      </div> : null}
      {item && isItem && canFix ? (
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
