"use client";

import { forwardRef } from "react";

const baseControl =
  "w-full bg-[var(--hm-surface)] text-[var(--hm-text)] border border-[var(--hm-border)] rounded-lg " +
  "placeholder:text-[var(--hm-text-tertiary)] transition-colors " +
  "focus:outline-none focus:border-[var(--hm-link)] focus:ring-2 focus:ring-[var(--hm-link)]/20 " +
  "disabled:opacity-60 disabled:cursor-not-allowed";

/** Optional label + error wrapper shared by the controls. */
function FieldShell({ label, error, hint, htmlFor, children }: { label?: string; error?: string; hint?: string; htmlFor?: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      {label && <label htmlFor={htmlFor} className="text-[12px] font-medium text-[var(--hm-text-secondary)]">{label}</label>}
      {children}
      {error ? <span className="text-[11px] text-[var(--tag-red-fg)]">{error}</span>
        : hint ? <span className="text-[11px] text-[var(--hm-text-tertiary)]">{hint}</span> : null}
    </div>
  );
}

interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> { label?: string; error?: string; hint?: string; }
export const Input = forwardRef<HTMLInputElement, InputProps>(function Input({ label, error, hint, id, className = "", ...props }, ref) {
  return (
    <FieldShell label={label} error={error} hint={hint} htmlFor={id}>
      <input ref={ref} id={id} className={baseControl + " h-9 px-3 text-[13px] " + (error ? "border-[var(--tag-red-fg)] " : "") + className} {...props} />
    </FieldShell>
  );
});

interface TextareaProps extends React.TextareaHTMLAttributes<HTMLTextAreaElement> { label?: string; error?: string; hint?: string; }
export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(function Textarea({ label, error, hint, id, className = "", ...props }, ref) {
  return (
    <FieldShell label={label} error={error} hint={hint} htmlFor={id}>
      <textarea ref={ref} id={id} className={baseControl + " px-3 py-2 text-[13px] leading-relaxed resize-y " + (error ? "border-[var(--tag-red-fg)] " : "") + className} {...props} />
    </FieldShell>
  );
});

interface SelectProps extends React.SelectHTMLAttributes<HTMLSelectElement> { label?: string; error?: string; hint?: string; }
export const Select = forwardRef<HTMLSelectElement, SelectProps>(function Select({ label, error, hint, id, className = "", children, ...props }, ref) {
  return (
    <FieldShell label={label} error={error} hint={hint} htmlFor={id}>
      <select ref={ref} id={id} className={baseControl + " h-9 px-2.5 text-[13px] cursor-pointer " + className} {...props}>{children}</select>
    </FieldShell>
  );
});
