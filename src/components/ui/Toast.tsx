"use client";

import { createContext, useCallback, useContext, useState } from "react";

type ToastTone = "default" | "success" | "error" | "info";
interface Toast { id: number; message: string; tone: ToastTone; }
interface ToastApi { show: (message: string, tone?: ToastTone) => void; }

const ToastContext = createContext<ToastApi | null>(null);

export function useToast(): ToastApi {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("useToast must be used within <ToastProvider>");
  return ctx;
}

// Left accent stripe carries the (semantic) colour; the card itself stays neutral
// chrome with a hairline border and no shadow.
const STRIPE: Record<ToastTone, string> = {
  default: "before:bg-[var(--hm-text-tertiary)]",
  success: "before:bg-[var(--tag-green-fg)]",
  error: "before:bg-[var(--tag-red-fg)]",
  info: "before:bg-[var(--hm-link)]",
};

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  // Monotonic id without Date.now()/Math.random() — a simple counter closes over render.
  const [seq, setSeq] = useState(0);

  const show = useCallback((message: string, tone: ToastTone = "default") => {
    setSeq((s) => {
      const id = s + 1;
      setToasts((t) => [...t, { id, message, tone }]);
      setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 4000);
      return id;
    });
  }, []);

  return (
    <ToastContext.Provider value={{ show }}>
      {children}
      <div className="fixed bottom-4 right-4 z-[110] flex flex-col gap-2 w-[320px] max-w-[calc(100vw-2rem)]">
        {toasts.map((t) => (
          <div
            key={t.id}
            role="status"
            className={
              "relative overflow-hidden pl-4 pr-3 py-2.5 rounded-lg bg-[var(--hm-surface)] border border-[var(--hm-border)] " +
              "text-[13px] text-[var(--hm-text)] " +
              "before:absolute before:left-0 before:top-0 before:bottom-0 before:w-1 " + STRIPE[t.tone]
            }
          >
            {t.message}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}
