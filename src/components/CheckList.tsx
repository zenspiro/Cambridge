import { Notice } from "@/components/AdminShell";
import { ActionForm } from "@/components/ActionForm";
import type { CheckItem } from "@/lib/agent/labels";

const MESSAGES: Record<string, string> = {
  ok_renamed: "Renamed. The library now lists it under the name its first page gives.",
  ok_removed: "Removed from the library.",
  gone: "That file is no longer in the library.",
  name: "That is not a Cambridge file name.",
  year: "That name is outside the library years.",
  no_syllabus: "The library has no syllabus version for that name.",
  same_name: "The library already has a file with that name. Remove one of the two instead.",
  storage: "The file could not be read from storage. Please try again.",
};

/** Library check results: each stored file whose first page says otherwise, with rename or remove. */
export function CheckList({
  runId, items, now, describe, message, at,
}: {
  runId: string;
  items: CheckItem[];
  /** Each file's name in the library now (undefined: removed). */
  now: Map<string, string>;
  describe: (name: string) => string;
  message?: string;
  at?: number;
}) {
  if (items.length === 0) return null;
  return (
    <section className="card stack" id="check">
      <h2 className="subtitle">Files whose first page says otherwise ({items.length})</h2>
      <p className="muted">The library check read these files&apos; first pages and they do not match their names. Rename a file to what its first page says, or remove it.</p>
      <ul className="list">
        {items.map((it, i) => {
          const current = now.get(it.id);
          const form = (action: string, label: string, danger = false) => (
            <ActionForm action="/admin/agent/fix" messages={MESSAGES} confirm={danger ? "Remove this file from the library?" : undefined}>
              <input type="hidden" name="id" value={runId} />
              <input type="hidden" name="i" value={i} />
              <input type="hidden" name="action" value={action} />
              <button className={danger ? "btn btn-small btn-danger" : "btn btn-small btn-primary"} type="submit">{label}</button>
            </ActionForm>
          );
          return (
            <li className="list-row review-row" key={it.id}>
              <span className="doc-main">
                <span>Stored as {describe(it.fileName)} <span className="mono muted">{it.fileName}</span></span>
                <span className="muted">{it.coverName ? `Its first page says: ${describe(it.coverName)} (${it.coverName}).` : `${it.why}.`}</span>
                {at === i ? <Notice code={message} messages={MESSAGES} /> : null}
              </span>
              <span className="review-act">
                {current === undefined ? (
                  <span className="muted">Removed.</span>
                ) : current !== it.fileName ? (
                  <span className="event-good">Renamed to {current}.</span>
                ) : (
                  <>
                    {it.coverName ? form("rename", `Rename to ${it.coverName}`) : null}
                    {form("remove", "Remove", true)}
                  </>
                )}
              </span>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
