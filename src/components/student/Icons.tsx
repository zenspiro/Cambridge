// Line icons for student and parent pages. Colour comes from the text colour (class s-icon), so themes restyle them.
const PATHS = {
  home: ["M3 11l9-8 9 8v10h-6v-6H9v6H3z"],
  practice: ["M12 20h9", "M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"],
  progress: ["M4 20V10", "M10 20V4", "M16 20v-7", "M22 20H2"],
  me: ["M12 4a4 4 0 1 1 0 8a4 4 0 1 1 0-8z", "M4 21c1-4 4-6 8-6s7 2 8 6"],
  flame: ["M12 2c1 4 5 6 5 11a5 5 0 0 1-10 0c0-3 2-4 2-7 2 1 3 3 3 5"],
  close: ["M6 6l12 12", "M18 6L6 18"],
} as const;

export type IconName = keyof typeof PATHS;

export function Icon({ name }: { name: IconName }) {
  return (
    <svg className="s-icon" viewBox="0 0 24 24" aria-hidden="true">
      {PATHS[name].map((d) => <path key={d} d={d} />)}
    </svg>
  );
}

/** The Playful theme's mascot. It shows only where the theme turns it on (token --t-mascot); it never speaks. */
export function Mascot() {
  return (
    <svg className="s-mascot" viewBox="0 0 64 64" aria-hidden="true">
      <path d="M32 4c14 0 26 10 26 26 0 17-11 30-26 30S6 47 6 30C6 14 18 4 32 4z" fill="#ffce3a" stroke="#1f1b2e" strokeWidth="3" />
      <circle cx="24" cy="28" r="5" fill="#1f1b2e" />
      <circle cx="40" cy="28" r="5" fill="#1f1b2e" />
      <circle cx="25.5" cy="26.5" r="1.6" fill="#ffffff" />
      <circle cx="41.5" cy="26.5" r="1.6" fill="#ffffff" />
      <path d="M24 40c4 5 12 5 16 0" fill="none" stroke="#1f1b2e" strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}
