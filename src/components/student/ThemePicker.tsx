"use client";
// The student's theme switch on "Me": saved to their account in the background, then the page redraws in the new
// look (no reload). Without scripts each button is still a plain form.
import { useRouter } from "next/navigation";
import { useState } from "react";
import { THEMES, type ThemeId } from "@/lib/config";

export function ThemePicker({ current }: { current: ThemeId }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  return (
    <div className="s-switch" role="group" aria-label="Theme">
      {THEMES.map((t) => (
        <form
          key={t.id}
          method="post"
          action="/account/theme"
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            try {
              await fetch("/account/theme", { method: "POST", body: new FormData(e.currentTarget) });
              router.refresh();
            } finally {
              setBusy(false);
            }
          }}
        >
          <input type="hidden" name="theme" value={t.id} />
          <button className="s-switch-btn" type="submit" disabled={busy} aria-pressed={t.id === current}>{t.label}</button>
        </form>
      ))}
    </div>
  );
}
