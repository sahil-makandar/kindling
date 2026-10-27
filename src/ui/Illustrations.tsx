// Small hand-drawn style illustrations, drawn here as SVG. Wobbly lines, flat colour, no gradients.

const INK = "#2A211C";

export function PeopleAtTable({ className, label = "Three people laughing round a table" }: { className?: string; label?: string }) {
  return (
    <svg viewBox="0 0 320 200" className={className} role="img" aria-label={label}>
      <ellipse cx="160" cy="150" rx="118" ry="30" fill="#FFD6B8" stroke={INK} strokeWidth="3.5" />
      <rect x="150" y="150" width="20" height="40" rx="6" fill="#EBD9C4" stroke={INK} strokeWidth="3" />
      {/* mugs */}
      <path d="M96 134h22l-3 20H99z" fill="#FFFCF6" stroke={INK} strokeWidth="3" strokeLinejoin="round" />
      <path d="M150 128h24l-3 22h-18z" fill="#FFC845" stroke={INK} strokeWidth="3" strokeLinejoin="round" />
      <path d="M204 134h22l-3 20h-16z" fill="#FFFCF6" stroke={INK} strokeWidth="3" strokeLinejoin="round" />
      {/* people */}
      <g strokeWidth="3.5" stroke={INK} strokeLinejoin="round">
        <path d="M54 130c-6-34 8-58 32-58s38 24 32 58z" fill="#FF6B35" />
        <circle cx="86" cy="52" r="20" fill="#FFD6B8" />
        <path d="M122 126c-6-38 10-64 38-64s44 26 38 64z" fill="#2D6A4F" />
        <circle cx="160" cy="40" r="22" fill="#FFD6B8" />
        <path d="M202 130c-6-34 8-58 32-58s38 24 32 58z" fill="#FFC845" />
        <circle cx="234" cy="52" r="20" fill="#FFD6B8" />
      </g>
      {/* faces */}
      <g fill={INK}>
        <circle cx="79" cy="50" r="2.6" /><circle cx="93" cy="50" r="2.6" />
        <circle cx="152" cy="38" r="2.8" /><circle cx="168" cy="38" r="2.8" />
        <circle cx="227" cy="50" r="2.6" /><circle cx="241" cy="50" r="2.6" />
      </g>
      <g fill="none" stroke={INK} strokeWidth="3" strokeLinecap="round">
        <path d="M80 60c3 5 10 5 13 0" /><path d="M152 50c4 6 12 6 16 0" /><path d="M228 60c3 5 10 5 13 0" />
      </g>
      {/* speech hearts */}
      <path d="M118 22c-5-8-14-2-9 6l9 9 9-9c5-8-4-14-9-6z" fill="#FF6B35" stroke={INK} strokeWidth="2.5" strokeLinejoin="round" transform="translate(66 -12) scale(0.8)" />
      <path d="M118 22c-5-8-14-2-9 6l9 9 9-9c5-8-4-14-9-6z" fill="#FFC845" stroke={INK} strokeWidth="2.5" strokeLinejoin="round" transform="translate(190 -4) scale(0.7)" />
    </svg>
  );
}

export function PosterOnBoard({ className, label = "A flyer pinned to a noticeboard" }: { className?: string; label?: string }) {
  return (
    <svg viewBox="0 0 320 220" className={className} role="img" aria-label={label}>
      <rect x="10" y="10" width="300" height="200" rx="14" fill="#EBD9C4" stroke={INK} strokeWidth="4" />
      <g transform="rotate(-4 120 110)">
        <rect x="40" y="34" width="130" height="160" rx="6" fill="#FFFCF6" stroke={INK} strokeWidth="3.5" />
        <rect x="52" y="48" width="106" height="14" rx="3" fill={INK} />
        <rect x="52" y="70" width="80" height="8" rx="3" fill="#EBD9C4" />
        <rect x="52" y="84" width="64" height="8" rx="3" fill="#EBD9C4" />
        <rect x="52" y="108" width="42" height="42" rx="4" fill="none" stroke={INK} strokeWidth="3" />
        <path d="M60 116h8v8h-8zM78 116h8v8h-8zM60 134h8v8h-8zM78 134h8v8h-8z" fill={INK} />
        <circle cx="105" cy="38" r="7" fill="#FF6B35" stroke={INK} strokeWidth="3" />
      </g>
      <g transform="rotate(5 238 100)">
        <rect x="190" y="50" width="96" height="104" rx="6" fill="#FFC845" stroke={INK} strokeWidth="3.5" />
        <path d="M204 80h68M204 96h50M204 112h60" stroke={INK} strokeWidth="5" strokeLinecap="round" />
        <circle cx="238" cy="54" r="7" fill="#2D6A4F" stroke={INK} strokeWidth="3" />
      </g>
    </svg>
  );
}
