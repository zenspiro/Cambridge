"use client";
// A form that posts in the background and updates the page in place: no reload, no jump to the
// top, folded sections stay as they are (owner, 5 Nov 2026: "no page refreshes unless necessary").
// The routes are the same plain POST routes (they answer with a redirect carrying a message code);
// the code is read from where the redirect lands. With `confirm`, the first press asks inline
// (Yes / Never mind), never with a browser popup. Without scripts it is still a plain form.
import { useRef, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";

type Props = {
  action: string;
  children: ReactNode;
  /** Message words by code ("ok_removed": "Source removed."). */
  messages: Readonly<Record<string, string>>;
  /** Ask inline before sending, with this question. */
  confirm?: string;
  className?: string;
  /** Add the folder counts from the redirect ("Added 2, already listed 0, not a folder link 1."). */
  counts?: boolean;
};

function folderCounts(q: URLSearchParams): string {
  const n = (k: string) => (/^\d{1,3}$/.test(q.get(k) ?? "") ? Number(q.get(k)) : 0);
  return q.has("added") ? `Added ${n("added")}, already listed ${n("dupes")}, not a folder link ${n("bad")}.` : "";
}

export function ActionForm({ action, children, messages, confirm, className, counts }: Props) {
  const router = useRouter();
  const form = useRef<HTMLFormElement>(null);
  const [asking, setAsking] = useState<FormData | null>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);

  async function send(data: FormData) {
    setBusy(true);
    setNote(null);
    try {
      const r = await fetch(action, { method: "POST", body: data });
      const q = new URL(r.url).searchParams;
      const code = q.get("e") ?? q.get("r") ?? q.get("f") ?? (r.ok ? "ok" : "failed");
      const ok = code.startsWith("ok");
      const text = [messages[code] ?? (ok ? "Done." : "That did not work. Please try again."), counts ? folderCounts(q) : ""].filter(Boolean).join(" ");
      setNote({ ok, text });
      if (ok) {
        form.current?.reset();
        router.refresh(); // fresh data from the server, same scroll position
      }
    } catch {
      setNote({ ok: false, text: "The server could not be reached. Please try again." });
    } finally {
      setBusy(false);
      setAsking(null);
    }
  }

  return (
    <form
      ref={form}
      className={className}
      method="post"
      action={action}
      onSubmit={(e) => {
        e.preventDefault();
        const data = new FormData(e.currentTarget);
        if (confirm) setAsking(data);
        else void send(data);
      }}
    >
      {asking ? (
        <span className="confirm" role="group" aria-label={confirm}>
          <span>{confirm}</span>
          <button className="btn btn-small btn-danger" type="button" disabled={busy} onClick={() => void send(asking)}>Yes</button>
          <button className="btn btn-small" type="button" disabled={busy} onClick={() => setAsking(null)}>Never mind</button>
        </span>
      ) : (
        <fieldset className="action-fields" disabled={busy}>{children}</fieldset>
      )}
      {note ? <span className={note.ok ? "action-note event-good" : "action-note event-bad"} role="status">{note.text}</span> : null}
    </form>
  );
}
