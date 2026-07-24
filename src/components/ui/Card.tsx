"use client";

interface CardProps extends React.HTMLAttributes<HTMLDivElement> {
  interactive?: boolean;
  padded?: boolean;
}

// Depth comes from a 1px border only — never a shadow. `interactive` adds a
// neutral hover (border + faint fill), no lift/transform.
export function Card({ interactive, padded = true, className = "", children, ...props }: CardProps) {
  return (
    <div
      className={
        "bg-[var(--hm-surface)] border border-[var(--hm-border)] rounded-xl transition-colors " +
        (padded ? "p-4 " : "") +
        (interactive ? "cursor-pointer hover:border-[var(--hm-text-tertiary)] hover:bg-[var(--hm-bg-secondary)] " : "") +
        className
      }
      {...props}
    >
      {children}
    </div>
  );
}
