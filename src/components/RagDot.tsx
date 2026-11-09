// A reading status as a dot only (owner, 8 Nov 2026): red nothing read, amber some read or flags open, green every
// stored paper read and ready. Words for screen readers and on hover; an empty slot keeps rows lined up.
const WORDS = {
  red: "Reading: not read yet",
  amber: "Reading: partly read, or flags still open",
  green: "Reading: every paper read and ready",
} as const;

export function RagDot({ rag }: { rag: keyof typeof WORDS | null }) {
  if (!rag) return <span className="rag rag-none" title="No papers stored to read" aria-hidden="true" />;
  return <span className={`rag rag-${rag}`} role="img" aria-label={WORDS[rag]} title={WORDS[rag]} />;
}
