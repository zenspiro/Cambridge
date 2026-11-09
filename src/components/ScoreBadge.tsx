// A paper's read accuracy as a red, amber or green badge (owner, 7 Nov 2026): how well the AIs read it by themselves
// on its first full reading. The pill shows the dot and the % (owner, 9 Nov 2026: no colour name); the colour's word
// is still there for screen readers and on hover, so it never relies on colour alone.
import type { PaperScore } from "@/lib/brain/paper";

const WORDS = { green: "Green", amber: "Amber", red: "Red" } as const;

export function ScoreBadge({ score, long = false }: { score: PaperScore | null; long?: boolean }) {
  if (!score) return null;
  const title = `${score.clean} of ${score.items} parts read with no flag${score.red ? `, ${score.red} wording flag${score.red === 1 ? "" : "s"}` : ""}${score.estimated ? " (estimated from the saved flags: read before the score was kept)" : ""}`;
  return (
    <span className={`score score-${score.colour}`} title={`${WORDS[score.colour]}: ${title}`}>
      <span className="score-dot" aria-hidden="true" />
      <span className="sr-only">{WORDS[score.colour]}: </span>{score.pct}%{score.estimated ? " (est.)" : ""}
      {long ? <span className="score-detail"> read accuracy: {title}</span> : <span className="sr-only"> read accuracy: {title}</span>}
    </span>
  );
}
