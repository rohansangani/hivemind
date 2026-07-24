"use client";

import { useEffect, useRef, useCallback } from "react";

interface ModalProps {
  open: boolean;
  onClose: () => void;
  title?: React.ReactNode;
  children: React.ReactNode;
  footer?: React.ReactNode;
  size?: "sm" | "md" | "lg";
}

const SIZES = { sm: "max-w-sm", md: "max-w-lg", lg: "max-w-2xl" };

// Depth from the border + a dim scrim only — no drop shadow. Focus is trapped
// inside the panel and ESC / scrim-click close it.
export function Modal({ open, onClose, title, children, footer, size = "md" }: ModalProps) {
  const panelRef = useRef<HTMLDivElement>(null);

  const onKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === "Escape") { onClose(); return; }
    if (e.key !== "Tab") return;
    const focusables = panelRef.current?.querySelectorAll<HTMLElement>(
      'a[href],button:not([disabled]),textarea,input,select,[tabindex]:not([tabindex="-1"])'
    );
    if (!focusables || focusables.length === 0) return;
    const first = focusables[0], last = focusables[focusables.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  }, [onClose]);

  useEffect(() => {
    if (!open) return;
    const prev = document.activeElement as HTMLElement | null;
    panelRef.current?.querySelector<HTMLElement>(
      'button:not([disabled]),a[href],input,textarea,select,[tabindex]:not([tabindex="-1"])'
    )?.focus();
    const { overflow } = document.body.style;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = overflow; prev?.focus?.(); };
  }, [open]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-[rgba(15,15,15,0.4)]"
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}
      onKeyDown={onKeyDown}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        className={"w-full " + SIZES[size] + " bg-[var(--hm-surface)] border border-[var(--hm-border)] rounded-xl max-h-[85vh] flex flex-col"}
      >
        {title && (
          <div className="flex items-center justify-between px-5 py-3.5 border-b border-[var(--hm-border)]">
            <h2 className="text-[14px] font-semibold text-[var(--hm-text)]">{title}</h2>
            <button
              onClick={onClose}
              aria-label="Close"
              className="w-7 h-7 -mr-1.5 inline-flex items-center justify-center rounded-md text-[var(--hm-text-tertiary)] hover:bg-[var(--hm-bg-tertiary)] hover:text-[var(--hm-text)] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--hm-link)]"
            >
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 6 6 18M6 6l12 12" /></svg>
            </button>
          </div>
        )}
        <div className="px-5 py-4 overflow-y-auto text-[13px] text-[var(--hm-text)]">{children}</div>
        {footer && <div className="flex items-center justify-end gap-2 px-5 py-3.5 border-t border-[var(--hm-border)]">{footer}</div>}
      </div>
    </div>
  );
}
