// Animated HiveMind logo loader — the hexagon frame draws on clockwise, then the
// six radiating lines unfold one by one clockwise (top → upper-right → … →
// upper-left) and loop. Colour follows the palette (near-black), so it matches the
// static logo everywhere. Respects prefers-reduced-motion.
export function LogoLoader({ size = 40, className = "" }: { size?: number; className?: string }) {
  // Radiating lines in clockwise order from 12 o'clock; index drives the stagger.
  const rays = [
    "M16 12 L16 6",        // top
    "M19.5 14 L24 10",     // upper-right
    "M19.5 18 L24 22",     // lower-right
    "M16 20 L16 26",       // bottom
    "M12.5 18 L8 22",      // lower-left
    "M12.5 14 L8 10",      // upper-left
  ];
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 32 32"
      role="status"
      aria-label="Loading"
      className={"hm-logo-loader " + className}
      fill="none"
    >
      <path
        className="hm-ll-hex"
        d="M16 2L28 9v14l-12 7L4 23V9z"
        stroke="var(--hm-text)"
        strokeWidth="1.5"
        strokeLinejoin="round"
        strokeLinecap="round"
      />
      {rays.map((d, i) => (
        <path
          key={i}
          className="hm-ll-ray"
          d={d}
          stroke="var(--hm-text)"
          strokeWidth="1.5"
          strokeLinecap="round"
          style={{ animationDelay: `${i * 0.12}s` }}
        />
      ))}
      <circle className="hm-ll-dot" cx="16" cy="16" r="3" fill="var(--hm-text)" />
    </svg>
  );
}
