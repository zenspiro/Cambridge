import { Notice } from "@/components/AdminShell";
import { decisionKey, type Decision, type ReviewItem } from "@/lib/agent/review";
import { groupFiles } from "@/lib/library/summary";

const MESSAGES: Record<string, string> = {
  ok_accepted: "Accepted. The next download run fetches it under that name.",
  ok_rejected: "Rejected. Later runs skip this file.",
  ok_undone: "Undone. The file is back to undecided.",
  bad: "Choose which file it is first.",
  taken: "Another file is already accepted as that one. Undo it first, or choose another.",
  stored: "The library already has that file, so there is nothing to fetch.",
  gone: "That run or its source is not available any more.",
};

/**
 * "Needs your eye" with a decision per file: accept it as one of this run's missing checklist
 * files, or reject it. Plain POST forms; later runs read the decisions.
 */
export function ReviewList({
  runId, items, decisions, choices, stored, describe, message, at,
}: {
  runId: string;
  items: ReviewItem[];
  decisions: Map<string, Decision>;
  /** Missing files this run's checklist asks for. */
  choices: string[];
  stored: (name: string) => boolean;
  describe: (name: string) => string;
  message?: string;
  at?: number;
}) {
  if (items.length === 0) return null;
  const groups = groupFiles(choices);
  const open = items.filter((it) => it.driveId && it.siteId && !decisions.has(decisionKey(it.siteId, it.driveId))).length;
  return (
    <section className="card stack" id="review">
      <details open={!!message || undefined}>
        <summary className="subtitle summary">Needs your eye ({items.length}{open && open !== items.length ? `, ${open} undecided` : ""})</summary>
        <p className="muted">
          The agent could not place these, so they were not stored. A download run reads the first page of unclear files
          before they come here. If one is a paper you want, choose which file it is and press Accept: the next download run
          fetches it under that name. Reject the rest so later runs skip them. Not in the list? Add it by hand from the
          library.
        </p>
        <ul className="list">
          {items.map((it, i) => {
            const d = it.driveId && it.siteId ? decisions.get(decisionKey(it.siteId, it.driveId)) : undefined;
            const preset = it.suggest && choices.includes(it.suggest) ? it.suggest : "";
            return (
              <li className="list-row review-row" key={i}>
                <span className="doc-main">
                  <span>{it.where}</span>
                  {it.why ? <span className="muted">{it.by === "ai" ? "The AI says" : it.by === "rules" ? "The rules say" : "Why"}: {it.why}</span> : null}
                  {it.suggest && !preset ? <span className="muted">The AI thought it is {describe(it.suggest)}, which this run does not look for.</span> : null}
                  {at === i ? <Notice code={message} messages={MESSAGES} /> : null}
                </span>
                {!it.driveId || !it.siteId ? null : d ? (
                  <span className="review-act">
                    <span className={d.decision === "accept" ? "event-good" : "muted"}>
                      {d.decision === "accept" && d.fileName
                        ? `Accepted as ${describe(d.fileName)}${stored(d.fileName) ? ", now in the library" : ", fetched by the next download"}.`
                        : "Rejected: later runs skip it."}
                    </span>
                    <form method="post" action="/admin/agent/review">
                      <input type="hidden" name="id" value={runId} />
                      <input type="hidden" name="i" value={i} />
                      <input type="hidden" name="action" value="undo" />
                      <button className="btn btn-small" type="submit">Undo</button>
                    </form>
                  </span>
                ) : (
                  <span className="review-act">
                    {choices.length ? (
                      <form className="actions" method="post" action="/admin/agent/review">
                        <input type="hidden" name="id" value={runId} />
                        <input type="hidden" name="i" value={i} />
                        <input type="hidden" name="action" value="accept" />
                        <label className="sr-only" htmlFor={`review-${i}`}>Which file is it?</label>
                        <select className="input review-select" id={`review-${i}`} name="name" required defaultValue={preset}>
                          <option value="" disabled>Which file is it?</option>
                          {groups.map((g) => (
                            <optgroup label={g.label} key={g.key}>
                              {g.files.map((f) => <option value={f.fileName} key={f.fileName}>{describe(f.fileName)}</option>)}
                            </optgroup>
                          ))}
                        </select>
                        <button className="btn btn-small btn-primary" type="submit">Accept</button>
                      </form>
                    ) : null}
                    <form method="post" action="/admin/agent/review">
                      <input type="hidden" name="id" value={runId} />
                      <input type="hidden" name="i" value={i} />
                      <input type="hidden" name="action" value="reject" />
                      <button className="btn btn-small" type="submit">Reject</button>
                    </form>
                  </span>
                )}
              </li>
            );
          })}
        </ul>
      </details>
    </section>
  );
}
