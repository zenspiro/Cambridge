"use client";
// Folder upload in the browser: pick a folder, see what every file is, then upload one file at
// a time. Reading names and first pages happens here, on this computer; only the AI questions
// and the files themselves go to the server.
import { useEffect, useRef, useState } from "react";
import type { KnownSubject } from "@/lib/agent/classify";
import { readCover } from "@/lib/library/cover";
import { applyAi, applyCover, finalise, isPdf, planFromNames, STATUS_WORDS, type PlanItem, type PlanStatus } from "@/lib/library/folderPlan";
import { REASON_LABELS } from "@/lib/library/labels";
import { parseCambridgeName } from "@/lib/library/names";
import { describeFile } from "@/lib/library/papers";
import { firstPageText } from "@/lib/pdf/firstPage";

type Phase = "idle" | "reading" | "preview" | "uploading" | "done";
type Result = { ok: boolean; text: string };

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

const describe = (name: string) => describeFile(name, null, () => null);

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
}) {
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
  useEffect(() => {
    input.current?.setAttribute("webkitdirectory", "");
    input.current?.setAttribute("directory", "");
  }, []);

  const codes = props.subjects.map((s) => s.code);

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
    const plan = pdfs.map((f, i) => planFromNames(i, f.webkitRelativePath || f.name, f.size, props.subjects, props.maxFileBytes));

    // The first page of every file: names the unclear ones and checks the others.
    for (let k = 0; k < plan.length; k++) {
      const it = plan[k]!;
      setDone(k);
      setStep(`Reading first pages: ${k + 1} of ${plan.length}`);
      if (it.status === "too_big") continue;
      // Older years (the Drive copies go back to 2002) are left out by their names alone.
      const named = it.name ? parseCambridgeName(it.name) : null;
      if (named && (named.year < props.fromYear || named.year > props.toYear)) continue;
      try {
        const text = await firstPageText(new Uint8Array(await pdfs[k]!.arrayBuffer()), inflate);
        applyCover(it, readCover(text, codes), text);
      } catch {
        // unreadable: the names stand
      }
    }

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

    finalise(plan, { have: new Set(props.have), codes, fromYear: props.fromYear, toYear: props.toYear });
    const preset: Record<number, string> = {};
    for (const it of plan) if (it.status === "review" && it.suggest && props.choices.some((c) => c.name === it.suggest)) preset[it.i] = it.suggest;
    setPicks(preset);
    setItems(plan);
    setPhase("preview");
  }

  async function upload() {
    stop.current = false;
    setStopNote("");
    setPhase("uploading");
    const queue = items.filter((it) => it.status === "new" || (it.status === "review" && picks[it.i]));
    const taken = new Set(queue.filter((it) => it.status === "new").map((it) => it.name!));
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
      let res: Result;
      try {
        const r = await fetch("/admin/library/folder/file", { method: "POST", headers: { "Content-Type": "application/pdf", "x-file-name": name }, body: files.current[it.i] });
        const out = (await r.json().catch(() => null)) as { ok?: boolean; reason?: string } | null;
        if (r.status === 401) {
          setStopNote("You were signed out. Sign in again and pick the folder: files already stored are skipped.");
          break;
        }
        if (r.status === 429) {
          setStopNote("Too many uploads this hour. Wait a little, then pick the folder again: files already stored are skipped.");
          break;
        }
        res = out?.ok ? { ok: true, text: `Stored as ${name}` } : { ok: false, text: REASON_LABELS[out?.reason as keyof typeof REASON_LABELS] ?? "could not be stored" };
      } catch {
        res = { ok: false, text: "the upload did not reach the server" };
      }
      setResults((r) => ({ ...r, [it.i]: res }));
    }
    setDone(queue.length);
    setPhase("done");
  }

  const counts = ORDER.map((s) => [s, items.filter((it) => it.status === s).length] as const).filter(([, n]) => n > 0);
  const toSend = items.filter((it) => it.status === "new").length + Object.values(picks).filter(Boolean).length;
  const stored = Object.values(results).filter((r) => r.ok).length;
  const failed = Object.values(results).filter((r) => !r.ok).length;

  return (
    <>
      <section className="card stack">
        <label className="label" htmlFor="folder">Folder</label>
        <input ref={input} className="input" id="folder" type="file" multiple disabled={phase === "reading" || phase === "uploading"}
          onChange={(e) => e.target.files && e.target.files.length > 0 && analyse([...e.target.files])} />
        <p className="muted">Choose the unzipped folder (for example the one for {props.subjectLabel}). Nothing is uploaded until you press Upload.</p>
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

      {phase === "preview" || phase === "uploading" || phase === "done" ? (
        <section className="card stack" id="folder-plan">
          <h2 className="subtitle">{phase === "done" ? `Stored ${stored} file${stored === 1 ? "" : "s"}${failed ? `, ${failed} not stored` : ""}` : `What is in the folder: ${items.length} PDFs`}</h2>
          <ul className="stats">
            {counts.map(([s, n]) => <li key={s}><strong>{n}</strong> {STATUS_WORDS[s].toLowerCase()}</li>)}
          </ul>
          {other ? <p className="muted">{other === 1 ? "1 file is not a PDF and was left out." : `${other} files are not PDFs and were left out.`}</p> : null}
          {aiNote ? <p className="muted">{aiNote}</p> : null}
          {stopNote ? <p className="alert" role="alert">{stopNote}</p> : null}
          {phase === "preview" ? (
            toSend ? (
              <div className="actions">
                <button className="btn btn-primary" type="button" onClick={upload}>Upload {toSend} file{toSend === 1 ? "" : "s"}</button>
              </div>
            ) : <p className="muted">Nothing new to upload.</p>
          ) : null}
        </section>
      ) : null}

      {(phase === "preview" || phase === "uploading" || phase === "done") ? ORDER.map((s) => {
        const list = items.filter((it) => it.status === s);
        if (!list.length) return null;
        return (
          <section className="card stack" key={s} id={`plan-${s}`}>
            <details open={s === "review" || undefined}>
              <summary className="subtitle summary">{STATUS_WORDS[s]} ({list.length})</summary>
              {s === "review" ? (
                <p className="muted">
                  Neither the names, the first page nor the AI could place these. If one is a {props.subjectLabel} file you want,
                  choose which it is; the rest are left out.
                </p>
              ) : null}
              <ul className="list">
                {list.map((it) => {
                  const res = results[it.i];
                  return (
                    <li className="list-row review-row" key={it.i}>
                      <span className="doc-main">
                        <span>{it.name ? describe(it.name) : it.fileName}</span>
                        <span className="mono muted">{[...it.path, it.fileName].join(" / ")}{it.name ? ` · ${it.name}` : ""}</span>
                        <span className="muted">
                          {it.how ? `Named from ${it.how}` : ""}{it.renamedFrom ? `, not ${it.renamedFrom}` : ""}{it.how && it.why ? ". " : ""}{it.why}
                        </span>
                      </span>
                      {res ? (
                        <span className={res.ok ? "event-good" : "event-bad"}>{res.text}</span>
                      ) : s === "review" && phase === "preview" && props.choices.length ? (
                        <span className="review-act">
                          <label className="sr-only" htmlFor={`pick-${it.i}`}>Which file is it?</label>
                          <select className="input review-select" id={`pick-${it.i}`} value={picks[it.i] ?? ""}
                            onChange={(e) => setPicks((p) => ({ ...p, [it.i]: e.target.value }))}>
                            <option value="">Leave it out</option>
                            {props.choices.map((c) => <option key={c.name} value={c.name}>{c.text}</option>)}
                          </select>
                        </span>
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
