"use client";
// Behaviour every admin page shares (owner, 8 Nov 2026: a functional admin). No inline handlers: listeners are added
// in an effect.
// - Plain forms (a full page post): the pressed button shows a busy spinner and a second press is ignored until the
//   next page arrives, so nothing is sent twice. Background forms (ActionForm) handle their own state.
// - Toasts: ActionForm announces each result ("admin-toast" event); it shows at the corner for a few seconds (errors
//   stay until closed) as well as beside its button.
import { useEffect, useState } from "react";

type Toast = { id: number; ok: boolean; text: string };

export function AdminEnhance() {
  const [toasts, setToasts] = useState<Toast[]>([]);

  useEffect(() => {
    let next = 1;
    const onToast = (e: Event) => {
      const d = (e as CustomEvent<{ ok: boolean; text: string }>).detail;
      if (!d || typeof d.text !== "string") return;
      const id = next++;
      setToasts((t) => [...t.slice(-3), { id, ok: !!d.ok, text: d.text }]);
      if (d.ok) window.setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 5000);
    };
    const onSubmit = (e: SubmitEvent) => {
      const form = e.target;
      if (!(form instanceof HTMLFormElement) || e.defaultPrevented) return;
      if (form.dataset.busy === "1") {
        e.preventDefault();
        return;
      }
      form.dataset.busy = "1";
      form.setAttribute("aria-busy", "true");
      const btn = e.submitter instanceof HTMLElement ? e.submitter : form.querySelector("button[type=submit]");
      btn?.classList.add("is-busy");
      // A download answers with a file and the page stays: free the form again after a while.
      window.setTimeout(() => {
        delete form.dataset.busy;
        form.removeAttribute("aria-busy");
        btn?.classList.remove("is-busy");
      }, 8000);
    };
    window.addEventListener("admin-toast", onToast);
    document.addEventListener("submit", onSubmit);
    return () => {
      window.removeEventListener("admin-toast", onToast);
      document.removeEventListener("submit", onSubmit);
    };
  }, []);

  return (
    <div className="toasts" aria-live="polite">
      {toasts.map((t) => (
        <div key={t.id} className={t.ok ? "toast toast-ok" : "toast toast-bad"} role={t.ok ? "status" : "alert"}>
          <span>{t.text}</span>
          <button className="toast-close" type="button" aria-label="Close" onClick={() => setToasts((x) => x.filter((y) => y.id !== t.id))}>×</button>
        </div>
      ))}
    </div>
  );
}
