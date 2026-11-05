"use client";
// A submit button that asks inline first (Yes / Never mind), never with a browser popup. The form itself stays a
// plain POST, so the page moves on as a normal navigation (used where the answer leaves the page).
import { useState } from "react";

export function ConfirmSubmit({ label, question, yes, className }: { label: string; question: string; yes: string; className: string }) {
  const [asking, setAsking] = useState(false);
  if (!asking) {
    return <button className={className} type="button" onClick={() => setAsking(true)}>{label}</button>;
  }
  return (
    <span className="s-confirm" role="group" aria-label={question}>
      <span>{question}</span>
      <button className={className} type="submit">{yes}</button>
      <button className="s-btn" type="button" onClick={() => setAsking(false)}>Never mind</button>
    </span>
  );
}
