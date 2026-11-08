// Topic tree pieces for the admin pages: the status line of a syllabus version and the tree itself.
// Server components (no client APIs).
import { BRAIN } from "@/lib/config";
import { isActive, type TreeRow } from "@/lib/brain/runs";
import { reasonWords, TIER_WORDS } from "@/lib/brain/labels";
import type { TreeNode } from "@/lib/brain/topics";

const minutes = (ms: number) => {
  const m = Math.max(0, Math.round(ms / 60_000));
  return m < 1 ? "less than a minute" : m === 1 ? "1 minute" : `${m} minutes`;
};

const day = (ms: number) => new Date(ms).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });

export function TreeStatusLine({ row, now }: { row: TreeRow; now: number }) {
  const run = row.run;
  const counts = `${row.topics} topics, ${row.goals} learning goals`;
  return (
    <div className="stack-tight">
      {row.status === "ready" ? (
        <p><span className="pill pill-ok">Ready</span> {counts}, every check passed{row.draftedAt ? ` (${day(row.draftedAt)})` : ""}.</p>
      ) : row.status === "not_ready" ? (
        <p><span className="pill pill-gap">Not ready</span> {counts}, but some checks did not pass, so later steps will not use it yet. Open the tree to see which, or redraft.</p>
      ) : (
        <p><span className="pill">Not drafted</span> No topic tree yet.</p>
      )}
      {run && isActive(run) ? (
        <p className="notice" role="status">
          {run.status === "queued" ? "Waiting for GitHub to start the run" : run.step ?? "Working"}, started {minutes(now - run.createdAt)} ago.
          This page refreshes every {BRAIN.refreshSeconds} seconds.
        </p>
      ) : run && run.status === "failed" ? (
        <p className="alert" role="alert">The last run stopped: {reasonWords(run.errorRef)}</p>
      ) : null}
    </div>
  );
}

export function TreeView({ nodes, depth = 0 }: { nodes: TreeNode[]; depth?: number }) {
  return (
    <ol className={depth === 0 ? "tree" : "tree tree-inner"}>
      {nodes.map((n) => (
        <li key={n.number} className="tree-topic" id={`topic-${n.number}`}>
          <p className={depth === 0 ? "tree-title tree-section" : "tree-title"}>
            <span className="tree-number">{n.number}</span> {n.title}
          </p>
          {n.goals.length > 0 ? (
            <ul className="tree-goals">
              {n.goals.map((g, i) => (
                <li key={`${g.number}-${i}`} className={g.flag ? "tree-goal tree-goal-flag" : "tree-goal"}>
                  <span className="tree-number">{g.number || "•"}</span>
                  <span className="tree-text">
                    {g.text}
                    <span className={g.tier === "supplement" ? "tag tag-extended" : g.tier === "core" ? "tag tag-core" : "tag"}>{TIER_WORDS[g.tier]}</span>
                    {g.flag ? <span className="tag tag-flag">Check open</span> : null}
                    {g.notes ? <span className="tree-notes">{g.notes}</span> : null}
                  </span>
                </li>
              ))}
            </ul>
          ) : null}
          {n.children.length > 0 ? <TreeView nodes={n.children} depth={depth + 1} /> : null}
        </li>
      ))}
    </ol>
  );
}
