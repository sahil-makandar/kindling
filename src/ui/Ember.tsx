import { cx } from "./cx";

export type EmberMood = "idle" | "thinking" | "waving" | "cheering" | "oops";

const MOTION: Record<EmberMood, string> = {
  idle: "animate-flicker",
  thinking: "animate-bob",
  waving: "animate-flicker",
  cheering: "animate-jump",
  oops: "",
};

// Ember, the mascot: a small flame with a face. Drawn here as plain SVG, no image files.
// Moods change the face and the movement. The motion stops under prefers-reduced-motion.
export function Ember({ mood = "idle", size = 96, className, label }: { mood?: EmberMood; size?: number; className?: string; label?: string }) {
  const eyeY = mood === "thinking" ? 70 : 76;
  const happy = mood === "cheering" || mood === "waving" || mood === "idle";
  return (
    <svg
      viewBox="0 0 100 120"
      width={size}
      height={(size * 120) / 100}
      className={cx("origin-bottom motion-reduce:animate-none", MOTION[mood], mood === "oops" && "-rotate-6", className)}
      role={label ? "img" : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
    >
      <path d="M50 6C57 28 86 44 86 78C86 102 70 114 50 114C30 114 14 102 14 78C14 58 28 48 36 28C41 36 44 41 47 46C49 32 50 20 50 6Z" fill="#FF6B35" stroke="#2A211C" strokeWidth="4" strokeLinejoin="round" />
      <path d="M50 58C58 70 72 80 72 94C72 106 62 111 50 111C38 111 28 106 28 94C28 80 42 70 50 58Z" fill="#FFC845" />
      {/* arms */}
      <ellipse cx="13" cy="88" rx="6" ry="9" fill="#FF6B35" stroke="#2A211C" strokeWidth="3.5" transform={mood === "cheering" ? "rotate(35 13 88)" : undefined} />
      <g className={cx("motion-reduce:animate-none", mood === "waving" && "animate-wave")} style={{ transformOrigin: "86px 86px", transformBox: "view-box" }}>
        <ellipse cx="87" cy={mood === "cheering" ? 82 : 88} rx="6" ry="9" fill="#FF6B35" stroke="#2A211C" strokeWidth="3.5" transform={mood === "cheering" ? "rotate(-35 87 82)" : undefined} />
      </g>
      {/* eyes */}
      <ellipse cx="39" cy={eyeY} rx="4.2" ry={mood === "oops" ? 3.4 : 5.4} fill="#2A211C" />
      <ellipse cx="61" cy={eyeY} rx="4.2" ry={mood === "oops" ? 3.4 : 5.4} fill="#2A211C" />
      <circle cx="40.5" cy={eyeY - 2} r="1.4" fill="#FFFCF6" />
      <circle cx="62.5" cy={eyeY - 2} r="1.4" fill="#FFFCF6" />
      {/* cheeks and mouth */}
      <ellipse cx="29" cy="88" rx="5" ry="3.2" fill="#FFD6B8" />
      <ellipse cx="71" cy="88" rx="5" ry="3.2" fill="#FFD6B8" />
      {mood === "cheering" ? (
        <path d="M41 90C43 102 57 102 59 90Z" fill="#2A211C" stroke="#2A211C" strokeWidth="2.5" strokeLinejoin="round" />
      ) : mood === "oops" ? (
        <path d="M43 98C47 92 53 92 57 98" fill="none" stroke="#2A211C" strokeWidth="3.2" strokeLinecap="round" />
      ) : mood === "thinking" ? (
        <path d="M45 94H56" fill="none" stroke="#2A211C" strokeWidth="3.2" strokeLinecap="round" />
      ) : happy ? (
        <path d="M42 90C45 98 55 98 58 90" fill="none" stroke="#2A211C" strokeWidth="3.2" strokeLinecap="round" />
      ) : null}
    </svg>
  );
}
