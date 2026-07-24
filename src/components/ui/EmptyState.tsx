"use client";

interface EmptyStateProps {
  icon?: React.ReactNode;
  title: string;
  description?: string;
  action?: React.ReactNode;
  className?: string;
}

export function EmptyState({ icon, title, description, action, className = "" }: EmptyStateProps) {
  return (
    <div className={"flex flex-col items-center justify-center text-center py-14 px-6 " + className}>
      {icon && <div className="mb-3 text-[var(--hm-text-tertiary)]">{icon}</div>}
      <h3 className="text-[14px] font-semibold text-[var(--hm-text)]">{title}</h3>
      {description && <p className="mt-1 text-[13px] text-[var(--hm-text-secondary)] max-w-sm">{description}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}
