"use client";

// The locked 8-tone tag palette — colour appears ONLY here (tags, status chips,
// data-viz legends), never in structural chrome. Keep the tone→meaning mapping
// stable across every screen.
export type Tone = "gray" | "green" | "yellow" | "orange" | "blue" | "purple" | "pink" | "red";

const TONES: Record<Tone, string> = {
  gray: "bg-[var(--tag-gray-bg)] text-[var(--tag-gray-fg)]",
  green: "bg-[var(--tag-green-bg)] text-[var(--tag-green-fg)]",
  yellow: "bg-[var(--tag-yellow-bg)] text-[var(--tag-yellow-fg)]",
  orange: "bg-[var(--tag-orange-bg)] text-[var(--tag-orange-fg)]",
  blue: "bg-[var(--tag-blue-bg)] text-[var(--tag-blue-fg)]",
  purple: "bg-[var(--tag-purple-bg)] text-[var(--tag-purple-fg)]",
  pink: "bg-[var(--tag-pink-bg)] text-[var(--tag-pink-fg)]",
  red: "bg-[var(--tag-red-bg)] text-[var(--tag-red-fg)]",
};

interface BadgeProps extends React.HTMLAttributes<HTMLSpanElement> {
  tone?: Tone;
  dot?: boolean;
}

export function Badge({ tone = "gray", dot, className = "", children, ...props }: BadgeProps) {
  return (
    <span
      className={
        "inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md text-[11px] font-medium leading-none whitespace-nowrap " +
        TONES[tone] + " " + className
      }
      {...props}
    >
      {dot && <span className="inline-block w-1.5 h-1.5 rounded-full bg-current opacity-70" />}
      {children}
    </span>
  );
}
