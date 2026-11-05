/** Fixed messages by code on student and parent pages (nothing from the address bar is shown as text). */
export function StudentNotice({ code, messages, errorRef }: { code?: string; messages: Readonly<Record<string, string>>; errorRef?: string }) {
  if (errorRef && /^[A-HJKMNP-TV-Z2-9]{4}-[A-HJKMNP-TV-Z2-9]{4}$/.test(errorRef)) {
    return <p className="s-note s-note-bad" role="alert">Something went wrong. Reference: {errorRef}</p>;
  }
  if (!code || !Object.hasOwn(messages, code)) return null;
  return <p className={code.startsWith("ok") ? "s-note s-note-good" : "s-note s-note-bad"} role="status">{messages[code]}</p>;
}
