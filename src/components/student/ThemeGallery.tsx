"use client";
// Theme gallery (admin): every student building block with sample words, in the theme picked with the switch.
// Switching happens in the browser, with no reload. The words are the same in every theme (owner, 5 Nov 2026).
import { useState } from "react";
import { THEMES, type ThemeId } from "@/lib/config";
import { StudentFrame, type FrameBrand, type NavItem } from "./StudentFrame";
import { Icon, Mascot } from "./Icons";

const NAV: readonly NavItem[] = [
  { href: "#home", label: "Home", icon: "home" },
  { href: "#practice", label: "Practice", icon: "practice" },
  { href: "#progress", label: "Progress", icon: "progress" },
  { href: "#me", label: "Me", icon: "me" },
];

const GRADES = [
  { subject: "Physics", grade: "A", value: 68, subj: "s-subj-1" },
  { subject: "Chemistry", grade: "B", value: 52, subj: "s-subj-2" },
  { subject: "Maths", grade: "A*", value: 86, subj: "s-subj-3" },
] as const;

const TASKS = [
  { title: "Parallel circuits", note: "5 questions, your weakest topic", subj: "s-subj-1" },
  { title: "Moles and mass", note: "Retest from Monday", subj: "s-subj-2" },
  { title: "Simultaneous equations", note: "3 exam-style questions", subj: "s-subj-3" },
] as const;

const OPTIONS = [
  { key: "A", text: "1 A" },
  { key: "B", text: "2 A" },
  { key: "C", text: "4 A" },
  { key: "D", text: "0.5 A" },
] as const;
const RIGHT = "C";

export function ThemeSwitch({ theme, onChange }: { theme: ThemeId; onChange: (t: ThemeId) => void }) {
  return (
    <div className="s-switch" role="group" aria-label="Theme">
      {THEMES.map((t) => (
        <button key={t.id} type="button" className="s-switch-btn" aria-pressed={t.id === theme} onClick={() => onChange(t.id)}>
          {t.label}
        </button>
      ))}
    </div>
  );
}

function Circuit() {
  return (
    <svg width="230" height="104" viewBox="0 0 230 104" role="img" aria-label="Circuit: a 12 volt battery with two 6 ohm resistors in parallel">
      <g fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M20 20h80M130 20h80M20 20v64M210 20v64M20 84h70M140 84h70M20 48h70M140 48h70" />
        <path d="M100 8v24M108 14v12" />
        <rect x="90" y="40" width="50" height="16" rx="3" />
        <rect x="90" y="76" width="50" height="16" rx="3" />
      </g>
      <g fill="currentColor" fontSize="12" textAnchor="middle">
        <text x="140" y="14">12 V</text>
        <text x="115" y="70">6 Ω</text>
        <text x="115" y="104">6 Ω</text>
      </g>
    </svg>
  );
}

/** The sample screens: home pieces, then a practice question that answers like the real one will. */
function Sample({ theme, setTheme }: { theme: ThemeId; setTheme: (t: ThemeId) => void }) {
  const [picked, setPicked] = useState<string | null>(null);
  const [hint, setHint] = useState(false);
  const state = (key: string) => (!picked ? undefined : key === RIGHT ? "right" : key === picked ? "wrong" : undefined);
  return (
    <>
      <div className="s-row">
        <h1 className="s-h1">Hi, Zara</h1>
        <ThemeSwitch theme={theme} onChange={setTheme} />
      </div>
      <div className="s-row">
        <Mascot />
        <span className="s-streak"><Icon name="flame" /> 12 day streak</span>
      </div>

      <section className="s-card s-feature" aria-label="Exam countdown">
        <span className="s-muted">Physics Paper 4</span>
        <span className="s-big">187 days</span>
        <span>to go. You are on track.</span>
      </section>

      <section className="s-card" aria-label="Predicted grades">
        <div className="s-row">
          <h2 className="s-h2">Predicted grade</h2>
          <span className="s-muted">Up 1 grade this month</span>
        </div>
        {GRADES.map((g) => (
          <div key={g.subject} className={`s-grade-row ${g.subj}`}>
            <span>{g.subject}</span>
            <progress className="s-progress" max={100} value={g.value} aria-label={`${g.subject} progress`} />
            <span className="s-grade">{g.grade}</span>
          </div>
        ))}
      </section>

      <section className="s-stack" aria-label="Today's plan">
        <div className="s-row">
          <h2 className="s-h2">Today&apos;s plan</h2>
          <span className="s-muted">About 15 minutes</span>
        </div>
        {TASKS.map((t, i) => (
          <div key={t.title} className={`s-task ${t.subj}`}>
            <span className="s-task-badge">{i + 1}</span>
            <span className="s-task-main">
              <span className="s-task-title">{t.title}</span>
              <span className="s-muted">{t.note}</span>
            </span>
          </div>
        ))}
        <a className="s-btn s-btn-primary s-btn-block" href="#practice">Start today&apos;s plan</a>
      </section>

      <section className="s-card" id="practice" aria-label="Practice question">
        <div className="s-wrap">
          <span className="s-chip s-chip-accent">Physics</span>
          <span className="s-chip">Parallel circuits</span>
          <span className="s-chip">1 mark</span>
        </div>
        <progress className="s-progress" max={5} value={3} aria-label="Question 3 of 5" />
        <p className="s-text">Two 6 Ω resistors are connected in parallel to a 12 V battery. What is the current from the battery?</p>
        <div className="s-figure"><Circuit /></div>
        <div className="s-stack">
          {OPTIONS.map((o) => (
            <button key={o.key} type="button" className="s-option" data-state={state(o.key)} onClick={() => { setPicked(o.key); setHint(false); }}>
              <span className="s-option-key">{o.key}</span>
              {o.text}
            </button>
          ))}
        </div>
        {picked && picked !== RIGHT ? (
          <div className="s-feedback s-feedback-bad" role="status">
            <span className="s-feedback-title">Where you lost the mark</span>
            <span>You used one 6 Ω resistor. In parallel the total is smaller: 1/R = 1/6 + 1/6, so R = 3 Ω and I = 12 ÷ 3 = 4 A.</span>
          </div>
        ) : null}
        {picked === RIGHT ? (
          <div className="s-feedback s-feedback-good" role="status">
            <span className="s-feedback-title">Correct</span>
            <span>Parallel resistors: 1/R = 1/6 + 1/6, R = 3 Ω, then I = V ÷ R = 4 A.</span>
          </div>
        ) : null}
        {hint && !picked ? <div className="s-hint">Hint: is the total resistance in parallel bigger or smaller than one resistor on its own?</div> : null}
        <div className="s-row">
          <button type="button" className="s-btn" onClick={() => setHint(!hint)}>I&apos;m stuck</button>
          <button type="button" className="s-btn s-btn-primary" onClick={() => { setPicked(null); setHint(false); }}>Try again</button>
        </div>
      </section>
    </>
  );
}

/** `boxed`: inside a phone-sized box on the admin page; otherwise the whole page, as a student would see it. */
export function ThemeGallery({ brand, initial, boxed }: { brand: FrameBrand; initial: ThemeId; boxed: boolean }) {
  const [theme, setTheme] = useState<ThemeId>(initial);
  const frame = (
    <StudentFrame brand={brand} theme={theme} nav={NAV} current="#home">
      <Sample theme={theme} setTheme={setTheme} />
    </StudentFrame>
  );
  return boxed ? <div className="gallery-phone" data-testid="gallery-phone">{frame}</div> : frame;
}
