import Link from "next/link";
import type { Cell, Status } from "@/lib/library/checklist";
import { tone } from "@/lib/library/catalog";
import { docTypeLabel } from "@/lib/config";

/** One file in the checklist: a tick that downloads it, or Add when it is missing. */
export function CellLink({ cell, label }: { cell: Cell | undefined; label?: string }) {
  if (!cell) return <span className="cell cell-na" aria-label="Not part of this paper">·</span>;
  const name = label ?? docTypeLabel(cell.docType);
  if (cell.doc) {
    return (
      <a className="cell cell-have" href={`/admin/library/file/${encodeURIComponent(cell.doc.id)}`} title={`${cell.fileName}: download`}>
        <span aria-hidden="true">✓</span>
        <span className="sr-only">{name}, have {cell.fileName}, download</span>
        {label ? <span className="cell-label">{label}</span> : null}
      </a>
    );
  }
  return (
    <Link
      className={cell.essential ? "cell cell-miss" : "cell cell-extra"}
      href={`/admin/library/add?file=${encodeURIComponent(cell.fileName)}`}
      title={`${cell.fileName}: missing, add it`}
    >
      <span aria-hidden="true">{cell.essential ? "✕" : "+"}</span>
      <span className="sr-only">
        {name}, {cell.essential ? "missing" : "extra, not stored"} {cell.fileName}, add
      </span>
      {label ? <span className="cell-label">{label}</span> : null}
    </Link>
  );
}

/** Essentials count with a coloured bar; extras in grey. */
export function StatusLine({ status, compact = false }: { status: Status; compact?: boolean }) {
  const t = tone(status);
  return (
    <div className={compact ? "status status-compact" : "status"}>
      <div className="row-between">
        <span className={`pill pill-${t}`}>
          {status.essentialHave} of {status.essentialTotal} essential
        </span>
        {status.extraTotal > 0 ? (
          <span className="muted">
            {status.extraHave} of {status.extraTotal} extra
          </span>
        ) : null}
      </div>
      <progress className={`bar bar-${t}`} max={Math.max(status.essentialTotal, 1)} value={status.essentialHave}>
        {status.essentialHave} of {status.essentialTotal}
      </progress>
    </div>
  );
}

export function GroupPill({ status }: { status: Status }) {
  if (status.essentialTotal === 0) return <span className="pill">extras only</span>;
  const t = tone(status);
  return (
    <span className={`pill pill-${t}`}>
      {t === "ok" ? "✓ " : ""}
      {status.essentialHave}/{status.essentialTotal}
    </span>
  );
}
