"use client";
// Folder upload in the browser: pick a folder, see what every file is, then upload one file at
// a time. Reading names and first pages happens here, on this computer; only the AI questions
// and the files themselves go to the server.
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { KnownSubject } from "@/lib/agent/classify";
import { readCover } from "@/lib/library/cover";
import { applyAi, applyCover, finalise, isPdf, noteFor, paperTitleChecks, planFromNames, STATUS_WORDS, type PlanItem, type PlanStatus } from "@/lib/library/folderPlan";
import { parseCambridgeName } from "@/lib/library/names";
import { REASON_LABELS } from "@/lib/library/labels";
import { describeFile, paperLookup, versionForFile, type Paper } from "@/lib/library/papers";
import { firstPageText } from "@/lib/pdf/firstPage";

type Phase = "idle" | "reading" | "preview" | "uploading" | "done";
/** One file's upload. `retry`: worth sending again (a server or network hiccup, not a refusal). */
type Result = { ok: boolean; text: string; retry?: boolean };

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
// Refusals that will not change on a second try; anything else (server hiccup) is retried.
const FINAL_REASONS = new Set(["name", "year", "size", "not_pdf", "no_syllabus", "same_name", "same_content"]);

const AI_CALLS = 60;
const AI_BATCH = 40;
const ORDER: PlanStatus[] = ["new", "review", "have", "not_needed", "outside", "unknown_subject", "duplicate", "too_big"];

/** zlib through the browser's DecompressionStream; keeps what was read when a stream ends badly. */
async function inflate(data: Uint8Array): Promise<Uint8Array> {
  const ds = new DecompressionStream("deflate");
  const writer = ds.writable.getWriter();
  writer.write(data as BufferSource).catch(() => {});
  writer.close().catch(() => {});
  const reader = ds.readable.getReader();
  const chunks: Uint8Array[] = [];
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
    }
  } catch {
    // a truncated stream: use what came out
  }
  const out = new Uint8Array(chunks.reduce((n, c) => n + c.length, 0));
  let o = 0;
  for (const c of chunks) {
    out.set(c, o);
    o += c.length;
  }
  return out;
}

type PaperName = { syllabus_id: string; paper: number; name: string };
type Version = { id: string; code: string; valid_from_year: number; valid_to_year: number };

/** Every file inside a dropped folder, with its path from the dropped folder down. */
async function filesFromDrop(items: DataTransferItemList): Promise<{ file: File; path: string }[]> {
  const out: { file: File; path: string }[] = [];
  const walk = async (entry: FileSystemEntry): Promise<void> => {
    if (entry.isFile) {
      const file = await new Promise<File | null>((ok) => (entry as FileSystemFileEntry).file(ok, () => ok(null)));
      if (file) out.push({ file, path: entry.fullPath.replace(/^\//, "") });
      return;
    }
    const reader = (entry as FileSystemDirectoryEntry).createReader();
    for (;;) {
      const batch = await new Promise<FileSystemEntry[]>((ok) => reader.readEntries(ok, () => ok([])));
      if (!batch.length) break;
      for (const e of batch) await walk(e);
    }
  };
  const roots = [...items].map((i) => i.webkitGetAsEntry?.()).filter((e): e is FileSystemEntry => !!e);
  for (const r of roots) await walk(r);
  return out;
}

async function postJson(url: string, body: unknown): Promise<{ status: number; data: Record<string, unknown> | null }> {
  try {
    const r = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    return { status: r.status, data: (await r.json().catch(() => null)) as Record<string, unknown> | null };
  } catch {
    return { status: 0, data: null };
  }
}

export function FolderUpload(props: {
  code: string;
  subjectLabel: string;
  subjects: KnownSubject[];
  have: string[];
  fromYear: number;
  toYear: number;
  maxFileBytes: number;
  choices: { name: string; text: string }[];
  /** Every subject, for the picker at the top of the card ("IGCSE Physics (0625)"). */
  subjectOptions: { code: string; label: string; qualification: string }[];
  /** Paper names and syllabus versions of every subject, so files read "Paper 2 Theory", not "Paper 2". */
  papers: PaperName[];
  versions: Version[];
}) {
  const look = paperLookup(props.papers as Paper[]);
  // Paper names come from the file's syllabus; another code (1524) uses its main syllabus (0625).
  const describe = (name: string) => {
    const code = mainCode(name.slice(0, 4));
    return describeFile(name, versionForFile(props.versions.filter((v) => v.code === code), name), look);
  };
  const versionOf = (name: string) => versionForFile(props.versions.filter((v) => v.code === mainCode(name.slice(0, 4))), name);
  // Where a file goes in the library, in full: "IGCSE Computer Science (0478) / 2020 / November / 0478_w20_qp_21.pdf".
  const SESSION_FOLDERS = { m: "March", s: "June", w: "November", y: "Syllabus and specimens" } as const;
  const placeOf = (name: string) => {
    const p = parseCambridgeName(name);
    if (!p) return name;
    const subj = subjectsRef.current.find((x) => x.code === p.code);
    const main = mainCode(p.code);
    const label = main === props.code ? props.subjectLabel : subj ? `${subj.qualification} ${subj.name} (${main})` : p.code;
    return `${label} / ${p.year} / ${SESSION_FOLDERS[p.session]} / ${p.fileName}`;
  };
  const router = useRouter();
  const [dragging, setDragging] = useState(false);
  // A dropped folder's files carry their paths here (a picked folder's files carry their own).
  const paths = useRef(new WeakMap<File, string>());
  const input = useRef<HTMLInputElement>(null);
  const files = useRef<File[]>([]);
  const stop = useRef(false);
  const [phase, setPhase] = useState<Phase>("idle");
  const [items, setItems] = useState<PlanItem[]>([]);
  const [other, setOther] = useState(0);
  const [step, setStep] = useState("");
  const [done, setDone] = useState(0);
  const [total, setTotal] = useState(0);
  const [aiNote, setAiNote] = useState("");
  const [picks, setPicks] = useState<Record<number, string>>({});
  const [results, setResults] = useState<Record<number, Result>>({});
  const [stopNote, setStopNote] = useState("");

  // Folder picking is not a standard attribute yet, so it is set here rather than in markup.
  // When the upload ends, bring the summary into view.
  useEffect(() => {
    if (phase === "done") document.getElementById("folder-done")?.scrollIntoView({ block: "start" });
  }, [phase]);

  useEffect(() => {
    input.current?.setAttribute("webkitdirectory", "");
    input.current?.setAttribute("directory", "");
  }, []);

  // Codes the page knows; grows when a first page links another code to a library subject.
  const subjectsRef = useRef<KnownSubject[]>(props.subjects);
  const [learned, setLearned] = useState<string[]>([]);
  const codesNow = () => subjectsRef.current.map((s) => s.code);
  /** Adds a code the server linked to a subject, and a line for the page. */
  const learn = (a: { code: string; main_code: string; label: string } | undefined, status: number, notes: string[]) => {
    if (status !== 200 || !a) return;
    const main = subjectsRef.current.find((s) => s.code === a.main_code);
    if (!main) return;
    if (!subjectsRef.current.some((s) => s.code === a.code)) subjectsRef.current = [...subjectsRef.current, { ...main, code: a.code, main: a.main_code, series: a.label }];
    notes.push(`${a.code} is the ${a.label} code of ${main.qualification} ${main.name} (${a.main_code})`);
  };
  const seriesOf = (code: string) => {
    const s = subjectsRef.current.find((x) => x.code === code && x.main);
    return s ? `${s.series || "Other series"} (${code})` : null;
  };
  const mainCode = (code: string) => subjectsRef.current.find((s) => s.code === code)?.main || code;
  // A suggested name can be picked when it is a library subject's file from a library year.
  const suggestable = (name: string) => {
    const p = parseCambridgeName(name);
    return !!p && codesNow().includes(p.code) && p.year >= props.fromYear && p.year <= props.toYear;
  };

  /** Every file and what happened to it, as a spreadsheet (CSV), to send in one go. */
  function downloadReport() {
    const cell = (v: string) => {
      const s = /^[=+\-@]/.test(v) ? `'${v}` : v; // a spreadsheet never runs a name as a formula
      return `"${s.replace(/"/g, '""')}"`;
    };
    const rows = [["Folder path", "File", "Result", "Library name", "What it is", "How it was worked out", "Why", "Upload"]];
    for (const it of items) {
      const name = it.name ?? picks[it.i] ?? it.suggest ?? "";
      rows.push([
        it.path.join(" / "), it.fileName, STATUS_WORDS[it.status], name, name ? describe(name) : "", it.how,
        it.dupOf ? `Same file as ${it.dupOf}` : `${it.renamedFrom ? `its names said ${it.renamedFrom}; ` : ""}${it.why}`,
        results[it.i]?.text ?? "",
      ]);
    }
    const csv = "\ufeff" + rows.map((r) => r.map(cell).join(",")).join("\r\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `folder-report-${props.code}.csv`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  }

  async function analyse(list: File[]) {
    setPhase("reading");
    setResults({});
    setPicks({});
    setAiNote("");
    const pdfs = list.filter((f) => isPdf(f.name, f.type));
    files.current = pdfs;
    setOther(list.length - pdfs.length);
    setTotal(pdfs.length);
    setStep("Reading names");
    const years = { fromYear: props.fromYear, toYear: props.toYear };
    const plan = pdfs.map((f, i) => planFromNames(i, paths.current.get(f) ?? (f.webkitRelativePath || f.name), f.size, props.subjects, props.maxFileBytes, years));
    const notes: string[] = [];

    // Files named with a code the library does not have, inside a library subject's folder
    // ("Maths 0580 / ... / 1521_j21_qp_32.pdf"): the code is linked to that subject first.
    const byFolder = new Map<string, PlanItem>();
    for (const it of plan) if (it.aliasOf && it.name && !codesNow().includes(it.name.slice(0, 4))) byFolder.set(it.name.slice(0, 4), it);
    for (const [code, it] of byFolder) {
      const p = parseCambridgeName(it.name!)!;
      if (p.session === "y") continue;
      setStep(`Linking code ${code} to its subject`);
      const pakistan = [...it.path, it.fileName].some((x) => /pakistan/i.test(x));
      const r = await postJson("/admin/library/folder/alias", { code, mainCode: it.aliasOf, year: p.year, session: p.session, label: pakistan ? "Pakistan series" : "" });
      learn(r.data?.alias as { code: string; main_code: string; label: string } | undefined, r.status, notes);
    }

    // The first page of every file: names the unclear ones and checks the others.
    const unknown = new Map<number, { text: string; code: NonNullable<ReturnType<typeof readCover>["unknownCode"]> }>();
    for (let k = 0; k < plan.length; k++) {
      const it = plan[k]!;
      setDone(k);
      setStep(`Reading first pages: ${k + 1} of ${plan.length}`);
      // Empty, too large, or from a year outside the library (the Drive copies go back to 2002): not read.
      if (it.status === "too_big" || it.status === "outside") continue;
      try {
        const text = await firstPageText(new Uint8Array(await pdfs[k]!.arrayBuffer()), inflate);
        const cover = readCover(text, codesNow());
        applyCover(it, cover, text, years);
        if (!it.name && cover.unknownCode) unknown.set(k, { text, code: cover.unknownCode });
      } catch {
        // unreadable: the names stand
      }
    }

    // A first page with a code the library does not have next to a library subject's name
    // ("PHYSICS 1524/12, May/June 2021"): the code is linked to that subject, then read again.
    const tried = new Set<string>();
    const before = notes.length;
    for (const { code } of unknown.values()) {
      if (tried.has(code.code) || codesNow().includes(code.code)) continue;
      tried.add(code.code);
      setStep(`Linking code ${code.code} to its subject`);
      const r = await postJson("/admin/library/folder/alias", code);
      learn(r.data?.alias as { code: string; main_code: string; label: string } | undefined, r.status, notes);
    }
    if (notes.length > before) for (const [k, u] of unknown) applyCover(plan[k]!, readCover(u.text, codesNow()), u.text, years);
    setLearned(notes);

    // The AI for what is left: first pages with text one by one, the rest by their names.
    let calls = 0;
    let aiOn = true;
    const switchOff = (status: number) => {
      aiOn = false;
      setAiNote(status === 503 ? "The AI is not available here, so only the names and first pages were used."
        : status === 429 ? "The AI question limit for this hour was reached; the rest used names and first pages only."
        : "The AI did not answer, so the rest used names and first pages only.");
    };
    const open = plan.filter((it) => !it.name && it.status === "review");
    const withText = open.filter((it) => it.text);
    for (let k = 0; k < withText.length && aiOn && calls < AI_CALLS; k++) {
      const it = withText[k]!;
      setStep(`Asking the AI about first pages: ${k + 1} of ${withText.length}`);
      calls++;
      const r = await postJson("/admin/library/folder/ai", { task: "cover", code: props.code, where: [...it.path, it.fileName].join(" / "), text: it.text });
      if (r.status !== 200) switchOff(r.status);
      else applyAi(it, r.data?.file as never, "first page");
    }
    const noText = open.filter((it) => !it.name && it.status === "review" && !it.text);
    for (let k = 0; k < noText.length && aiOn && calls < AI_CALLS; k += AI_BATCH) {
      const batch = noText.slice(k, k + AI_BATCH);
      setStep(`Asking the AI about file names: ${Math.min(k + AI_BATCH, noText.length)} of ${noText.length}`);
      calls++;
      const r = await postJson("/admin/library/folder/ai", { task: "names", code: props.code, files: batch.map((it) => ({ path: it.path.slice(-10), name: it.fileName })) });
      if (r.status !== 200) {
        switchOff(r.status);
        break;
      }
      const answers = Array.isArray(r.data?.files) ? (r.data!.files as { i: number }[]) : [];
      batch.forEach((it, j) => applyAi(it, answers.find((a) => a.i === j) as never, "names"));
    }

    finalise(plan, { have: new Set(props.have), codes: codesNow(), fromYear: props.fromYear, toYear: props.toYear });
    // The AI's best guess is chosen for you: you check it, choose another, or leave it out.
    const preset: Record<number, string> = {};
    for (const it of plan) if (it.status === "review" && it.suggest && suggestable(it.suggest)) preset[it.i] = it.suggest;
    setPicks(preset);
    setItems(plan);
    setPhase("preview");
  }

  /**
   * Sends one file. A reply that is not the server's own answer (a Cloudflare error page while the
   * Worker starts, a dropped connection, a 5xx) is tried again after 2, 5 and 10 seconds.
   */
  async function sendOne(name: string, file: File): Promise<Result | "signed_out" | "busy"> {
    let last: Result = { ok: false, text: "the upload did not reach the server", retry: true };
    for (const pause of [0, 2000, 5000, 10000]) {
      if (pause) await wait(pause);
      try {
        const r = await fetch("/admin/library/folder/file", { method: "POST", headers: { "Content-Type": "application/pdf", "x-file-name": name }, body: file });
        if (r.status === 401) return "signed_out";
        if (r.status === 429) return "busy";
        const out = (await r.json().catch(() => null)) as { ok?: boolean; reason?: string; error?: string } | null;
        if (out?.ok) return { ok: true, text: `Stored as ${name}` };
        if (out?.reason && FINAL_REASONS.has(out.reason)) return { ok: false, text: REASON_LABELS[out.reason as keyof typeof REASON_LABELS] };
        last = {
          ok: false, retry: true,
          text: out?.reason === "storage" ? "the server could not save it (tried 4 times)"
            : out?.error === "forbidden" ? "the server refused the request (reload the page and try again)"
            : `the server did not answer properly (error ${r.status}, tried 4 times)`,
        };
        if (out?.error === "forbidden") return last;
      } catch {
        last = { ok: false, text: "the upload did not reach the server (tried 4 times)", retry: true };
      }
    }
    return last;
  }

  async function upload(only?: PlanItem[]) {
    stop.current = false;
    setStopNote("");
    setPhase("uploading");
    const queue = only ?? items.filter((it) => it.status === "new" || (it.status === "review" && picks[it.i]));
    const taken = new Set(only ? [] : queue.filter((it) => it.status === "new").map((it) => it.name!));
    setTotal(queue.length);
    let k = 0;
    for (const it of queue) {
      if (stop.current) {
        setStopNote("Stopped. Pick the folder again to carry on: files already stored are skipped.");
        break;
      }
      setDone(k++);
      setStep(`Uploading ${k} of ${queue.length}`);
      const name = it.status === "new" ? it.name! : picks[it.i]!;
      if (it.status === "review" && taken.has(name)) {
        setResults((r) => ({ ...r, [it.i]: { ok: false, text: "another file in this folder is that file" } }));
        continue;
      }
      taken.add(name);
      const res = await sendOne(name, files.current[it.i]!);
      if (res === "signed_out") {
        setStopNote("You were signed out. Sign in again and pick the folder: files already stored are skipped.");
        break;
      }
      if (res === "busy") {
        setStopNote("Too many uploads this hour. Wait a little, then press Try again: files already stored are skipped.");
        break;
      }
      setResults((r) => ({ ...r, [it.i]: res }));
    }
    setDone(queue.length);
    setPhase("done");
  }

  const titleChecks = phase === "preview" ? paperTitleChecks(items, props.papers, versionOf) : [];
  const versionLabel = (id: string) => {
    const v = props.versions.find((x) => x.id === id);
    return v ? `${v.valid_from_year} to ${v.valid_to_year} syllabus` : id;
  };
  const counts = ORDER.map((s) => [s, items.filter((it) => it.status === s).length] as const).filter(([, n]) => n > 0);
  const toSend = items.filter((it) => it.status === "new").length + Object.values(picks).filter(Boolean).length;

  return (
    <>
      <section
        className={dragging ? "card stack drop-zone drop-zone-on" : "card stack drop-zone"}
        id="folder-card"
        onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
        onDragLeave={() => setDragging(false)}
        onDrop={async (e) => {
          e.preventDefault();
          setDragging(false);
          if (phase === "reading" || phase === "uploading") return;
          const found = await filesFromDrop(e.dataTransfer.items);
          for (const f of found) paths.current.set(f.file, f.path);
          if (found.length) void analyse(found.map((f) => f.file));
        }}
      >
        <label className="label-inline" htmlFor="folder-code">Main subject of the folder</label>
        <select className="input review-select" id="folder-code" value={props.code} disabled={phase === "reading" || phase === "uploading"}
          onChange={(e) => router.replace(`/admin/library/folder?code=${encodeURIComponent(e.target.value)}`, { scroll: false })}>
          {[...new Set(props.subjectOptions.map((s) => s.qualification))].map((ql) => (
            <optgroup label={ql} key={ql}>
              {props.subjectOptions.filter((s) => s.qualification === ql).map((s) => <option key={s.code} value={s.code}>{s.label}</option>)}
            </optgroup>
          ))}
        </select>
        <label className="label-inline" htmlFor="folder">Folder</label>
        <input ref={input} className="input" id="folder" type="file" multiple disabled={phase === "reading" || phase === "uploading"}
          onChange={(e) => e.target.files && e.target.files.length > 0 && analyse([...e.target.files])} />
        <p className="muted">
          Drag the unzipped folder onto this box, or choose it above. Dragging skips the browser&apos;s own &quot;Upload files to this
          site?&quot; question, which a site cannot switch off. Files of other subjects are still recognised and stored. Nothing is
          uploaded until you press Upload.
        </p>
      </section>

      {phase === "reading" || phase === "uploading" ? (
        <section className="card stack" aria-live="polite">
          <div className="row-between">
            <span>{step}</span>
            <span className="muted">{total ? `${Math.round((done / total) * 100)}%` : ""}</span>
          </div>
          <progress className="bar" max={Math.max(total, 1)} value={done}>{done}</progress>
          {phase === "uploading" ? (
            <div className="actions">
              <button className="btn btn-small" type="button" onClick={() => { stop.current = true; }}>Stop after this file</button>
            </div>
          ) : null}
        </section>
      ) : null}

      {phase === "done" ? (() => {
        const sent = items.filter((it) => results[it.i]);
        const good = sent.filter((it) => results[it.i]!.ok);
        const bad = sent.filter((it) => !results[it.i]!.ok);
        const again = bad.filter((it) => results[it.i]!.retry);
        const have = items.filter((it) => it.status === "have").length;
        const left = items.length - sent.length - have;
        return (
          <section className="card stack" id="folder-done">
            <h2 className="subtitle">Upload finished</h2>
            <p className={bad.length ? "alert" : "notice"} role="status">
              {good.length} file{good.length === 1 ? "" : "s"} stored{bad.length ? `, ${bad.length} not stored (reasons below)` : ""}.
              {have ? ` ${have} were already in the library.` : ""}{left > 0 ? ` ${left} were left out (outside the years, not needed, or not picked).` : ""}
            </p>
            <div className="actions">
              <a className="btn btn-small btn-primary" href={`/admin/library/${encodeURIComponent(props.code)}`}>Open {props.subjectLabel} in the library</a>
              {again.length ? (
                <button className="btn btn-small btn-primary" type="button" id="folder-retry" onClick={() => upload(again)}>
                  Try the {again.length} failed file{again.length === 1 ? "" : "s"} again
                </button>
              ) : null}
              <button className="btn btn-small" type="button" onClick={downloadReport}>Download report</button>
            </div>
            {good.length ? (
              <details>
                <summary className="subtitle summary">Stored ({good.length})</summary>
                <ul className="list">
                  {good.map((it) => (
                    <li className="list-row" key={it.i}>
                      <span className="doc-main"><span>{describe(results[it.i]!.text.replace(/^Stored as /, ""))}</span><span className="mono muted">{[...it.path, it.fileName].join(" / ")}</span></span>
                      <span className="event-good">{results[it.i]!.text}</span>
                    </li>
                  ))}
                </ul>
              </details>
            ) : null}
            {bad.length ? (
              <details open>
                <summary className="subtitle summary">Not stored ({bad.length})</summary>
                <ul className="list">
                  {bad.map((it) => (
                    <li className="list-row" key={it.i}>
                      <span className="doc-main"><span>{it.name ? describe(it.name) : it.fileName}</span><span className="mono muted">{[...it.path, it.fileName].join(" / ")}</span></span>
                      <span className="event-bad">{results[it.i]!.text}</span>
                    </li>
                  ))}
                </ul>
              </details>
            ) : null}
          </section>
        );
      })() : null}

      {phase === "preview" || phase === "uploading" ? (
        <section className="card stack" id="folder-plan">
          <h2 className="subtitle">What is in the folder: {items.length} PDFs</h2>
          <ul className="stats">
            {counts.map(([s, n]) => <li key={s}><strong>{n}</strong> {STATUS_WORDS[s].toLowerCase()}</li>)}
          </ul>
          {other ? <p className="muted">{other === 1 ? "1 file is not a PDF and was left out." : `${other} files are not PDFs and were left out.`}</p> : null}
          {aiNote ? <p className="muted">{aiNote}</p> : null}
          {learned.length ? (
            <p className="notice" id="folder-learned">
              Linked by itself: {learned.join("; ")}. Those files are stored under their own names, with that subject.
            </p>
          ) : null}
          {stopNote ? <p className="alert" role="alert">{stopNote}</p> : null}
          {titleChecks.length ? (
            <div className="stack" id="title-checks">
              <p className="alert">The first pages name some papers differently from the library. The library&apos;s names for older syllabuses were copied from the next syllabus, so the cover is probably right:</p>
              <ul className="list">
                {titleChecks.map((t) => (
                  <li className="list-row" key={`${t.versionId}-${t.paper}`}>
                    <span className="doc-main">
                      <span>{versionLabel(t.versionId)}, Paper {t.paper}: the cover says &ldquo;{t.cover}&rdquo;, the library says &ldquo;{t.library}&rdquo;</span>
                      <span className="mono muted">for example {t.example}</span>
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
          {phase === "preview" ? (
            <div className="actions">
              {toSend ? <button className="btn btn-primary" type="button" onClick={() => upload()}>Upload {toSend} file{toSend === 1 ? "" : "s"}</button> : <p className="muted">Nothing new to upload.</p>}
              <button className="btn btn-small" type="button" id="folder-report" onClick={downloadReport}>Download report</button>
            </div>
          ) : null}
        </section>
      ) : null}

      {(phase === "preview" || phase === "uploading" || phase === "done") ? ORDER.map((s) => {
        if (phase === "done" && s === "new") return null; // shown in the summary above
        const list = items.filter((it) => it.status === s);
        if (!list.length) return null;
        return (
          <section className="card stack" key={s} id={`plan-${s}`}>
            <details open={s === "review" || undefined}>
              <summary className="subtitle summary">{STATUS_WORDS[s]} ({list.length})</summary>
              {s === "review" ? (
                <p className="muted">
                  These are the only files it could not settle by itself. Where the AI had a guess it is already
                  chosen: check it and upload, choose another file, or leave it out.
                </p>
              ) : null}
              <ul className="list">
                {list.map((it) => {
                  const res = results[it.i];
                  return (
                    <li className="list-row review-row" key={it.i}>
                      <span className="doc-main">
                        <span>{it.name ? describe(it.name) : it.fileName}</span>
                        <span className="mono muted">{[...it.path, it.fileName].join(" / ")}</span>
                        {it.name && it.name !== it.fileName.toLowerCase() && (it.status === "new" || it.status === "have") ? (
                          <span>{it.status === "have" ? "In the library as" : "Will be stored as"} <span className="mono">{it.name}</span></span>
                        ) : null}
                        <span className="row-note">{noteFor(it, { fromYear: props.fromYear, toYear: props.toYear, describe, seriesOf })}</span>
                        {!res && s === "review" && phase === "preview" && props.choices.length ? (
                          // Its own line, the full width of the row, so the whole place in the library shows.
                          <span className="pick-line">
                            <label className="label-inline" htmlFor={`pick-${it.i}`}>Which file is it?</label>
                            <select className="input pick-select" id={`pick-${it.i}`} value={picks[it.i] ?? ""}
                              onChange={(e) => setPicks((p) => ({ ...p, [it.i]: e.target.value }))}>
                              <option value="">Leave it out</option>
                              {it.suggest && suggestable(it.suggest) && !props.choices.some((c) => c.name === it.suggest) ? (
                                <option value={it.suggest}>{`${placeOf(it.suggest)}: ${describe(it.suggest)} (the AI's guess)`}</option>
                              ) : null}
                              {props.choices.map((c) => <option key={c.name} value={c.name}>{`${placeOf(c.name)}: ${c.text}${c.name === it.suggest ? " (the AI's guess)" : ""}`}</option>)}
                            </select>
                            {picks[it.i] ? <span className="muted">Goes to <span className="mono">{placeOf(picks[it.i]!)}</span></span> : null}
                          </span>
                        ) : null}
                      </span>
                      {res ? (
                        <span className={res.ok ? "event-good" : "event-bad"}>{res.text}</span>
                      ) : null}
                    </li>
                  );
                })}
              </ul>
            </details>
          </section>
        );
      }) : null}
    </>
  );
}
