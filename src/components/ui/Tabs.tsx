"use client";

export interface TabItem { key: string; label: React.ReactNode; count?: number; }

interface TabsProps {
  tabs: TabItem[];
  value: string;
  onChange: (key: string) => void;
  className?: string;
}

// Underline-style tabs. Active tab is near-black text with a near-black underline
// (structural chrome stays neutral — no blue).
export function Tabs({ tabs, value, onChange, className = "" }: TabsProps) {
  return (
    <div role="tablist" className={"flex items-center gap-1 border-b border-[var(--hm-border)] " + className}>
      {tabs.map((t) => {
        const active = t.key === value;
        return (
          <button
            key={t.key}
            role="tab"
            aria-selected={active}
            onClick={() => onChange(t.key)}
            className={
              "relative -mb-px px-3 h-9 text-[13px] font-medium transition-colors border-b-2 " +
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--hm-link)] rounded-t " +
              (active
                ? "text-[var(--hm-text)] border-[var(--hm-primary)]"
                : "text-[var(--hm-text-secondary)] border-transparent hover:text-[var(--hm-text)]")
            }
          >
            {t.label}
            {typeof t.count === "number" && (
              <span className="ml-1.5 text-[11px] text-[var(--hm-text-tertiary)]">{t.count}</span>
            )}
          </button>
        );
      })}
    </div>
  );
}
