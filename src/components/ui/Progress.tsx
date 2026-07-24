"use client";

interface ProgressProps {
  value: number; // 0-100
  className?: string;
  tone?: "primary" | "green" | "blue";
}

const FILL = {
  primary: "bg-[var(--hm-primary)]",
  green: "bg-[var(--tag-green-fg)]",
  blue: "bg-[var(--hm-link)]",
};

export function Progress({ value, className = "", tone = "primary" }: ProgressProps) {
  const pct = Math.min(100, Math.max(0, value));
  return (
    <div className={"w-full h-1.5 rounded-full bg-[var(--hm-bg-tertiary)] overflow-hidden " + className} role="progressbar" aria-valuenow={Math.round(pct)} aria-valuemin={0} aria-valuemax={100}>
      <div className={"h-full rounded-full transition-[width] duration-300 " + FILL[tone]} style={{ width: pct + "%" }} />
    </div>
  );
}
