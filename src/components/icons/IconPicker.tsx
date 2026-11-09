"use client";
// The icon chooser (owner, 9 Nov 2026: "a popup icon selector"): a panel over the page (a <dialog>, never a browser
// popup) with a search box and every icon in the set. A click saves in the background, closes the panel and refreshes
// the page's data; the result also shows as a toast.
import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ICONS } from "./set";
import { AppIcon } from "./AppIcon";

const words = (name: string) => name.replace(/-/g, " ");

export function IconPicker({ slot, place, current }: { slot: string; place: string; current: string }) {
  const router = useRouter();
  const dialog = useRef<HTMLDialogElement>(null);
  const search = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const names = useMemo(() => Object.keys(ICONS), []);
  const shown = useMemo(() => {
    const parts = q.trim().toLowerCase().split(/\s+/).filter(Boolean);
    return parts.length ? names.filter((n) => parts.every((p) => words(n).split(" ").some((w) => w.startsWith(p)))) : names;
  }, [q, names]);

  useEffect(() => {
    const d = dialog.current;
    if (!d) return;
    if (open && !d.open) {
      d.showModal();
      requestAnimationFrame(() => search.current?.focus());
    }
    if (!open && d.open) d.close();
    const onClose = () => setOpen(false);
    d.addEventListener("close", onClose);
    return () => d.removeEventListener("close", onClose);
  }, [open]);

  async function choose(name: string) {
    setBusy(true);
    setError("");
    const data = new FormData();
    data.set("slot", slot);
    data.set("name", name);
    try {
      const r = await fetch("/admin/icons/save", { method: "POST", body: data });
      const code = new URL(r.url).searchParams.get("e") ?? "";
      const ok = code === "ok_saved";
      window.dispatchEvent(new CustomEvent("admin-toast", { detail: { ok, text: ok ? `${place}: icon changed to ${words(name)}.` : "That icon could not be saved. Please try again." } }));
      if (!ok) {
        setError("That icon could not be saved. Please try again.");
        return;
      }
      setOpen(false);
      setQ("");
      router.refresh();
    } catch {
      setError("No answer from the server. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <button className="btn btn-small" type="button" onClick={() => setOpen(true)}>Change</button>
      <dialog ref={dialog} className="icon-dialog" aria-label={`Choose the icon for ${place}`}>
        {/* Drawn only while open: one grid of the whole set, not one per row of the page. */}
        {open ? <>
        <div className="icon-dialog-head">
          <h2 className="subtitle m-0">Icon for {place}</h2>
          <button className="btn btn-small" type="button" onClick={() => setOpen(false)}>Close</button>
        </div>
        <label className="field">
          <span className="label-inline">Search</span>
          <input ref={search} className="input" type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="e.g. book, chart, user" />
        </label>
        <p className="hint m-0">{shown.length} of {names.length} icons. Now: {words(current)}.</p>
        {error ? <p className="alert m-0" role="alert">{error}</p> : null}
        <div className="icon-grid" aria-busy={busy}>
          {shown.map((n) => (
            <button key={n} type="button" className={n === current ? "icon-choice icon-choice-current" : "icon-choice"} disabled={busy}
              onClick={() => choose(n)} aria-pressed={n === current} title={words(n)}>
              <AppIcon name={n} className="icon-choice-svg" />
              <span className="icon-choice-name">{words(n)}</span>
            </button>
          ))}
          {!shown.length ? <p className="muted">No icon matches. Try another word.</p> : null}
        </div>
        </> : null}
      </dialog>
    </>
  );
}
