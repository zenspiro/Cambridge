"use client";
// Back on the review screen (owner, 10 Nov 2026: "go back to where I came from"). Where you came from is the last
// admin page that was not a review screen (Documents with its filters, a session, Home), kept for this tab, so
// switching between a paper's files on the review screen does not change it. A full load, never a client-side move.
import { useEffect, useState } from "react";

const KEY = "review:back";
const REVIEW = /^\/admin\/library\/review\//;

export function BackLink({ fallback, fallbackLabel }: { fallback: string; fallbackLabel: string }) {
  const [to, setTo] = useState<{ href: string; label: string }>({ href: fallback, label: fallbackLabel });
  useEffect(() => {
    let href = "";
    try {
      const ref = document.referrer ? new URL(document.referrer) : null;
      if (ref && ref.origin === location.origin && ref.pathname.startsWith("/admin") && !REVIEW.test(ref.pathname)) {
        href = ref.pathname + ref.search + ref.hash;
        sessionStorage.setItem(KEY, href);
      } else {
        href = sessionStorage.getItem(KEY) ?? "";
      }
    } catch {
      href = "";
    }
    if (href.startsWith("/admin") && !href.startsWith("//")) setTo({ href, label: "Back" });
  }, []);
  return <a className="btn" href={to.href}>{to.label === "Back" ? "← Back" : to.label}</a>;
}
