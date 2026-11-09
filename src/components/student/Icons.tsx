// The Playful theme's mascot (menu and other icons are Lucide, chosen in Settings > Icons: src/components/icons).
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
