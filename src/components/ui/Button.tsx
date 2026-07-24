"use client";

import { forwardRef } from "react";
import { Spinner } from "./Spinner";

type Variant = "primary" | "secondary" | "ghost" | "danger";
type Size = "sm" | "md";

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  loading?: boolean;
  leftIcon?: React.ReactNode;
  rightIcon?: React.ReactNode;
}

// Primary = near-black (never a saturated brand colour). Depth from border only,
// no shadows. Blue is reserved for links, not buttons.
const VARIANTS: Record<Variant, string> = {
  primary: "bg-[var(--hm-primary)] text-white border border-[var(--hm-primary)] hover:bg-[var(--hm-primary-hover)] hover:border-[var(--hm-primary-hover)]",
  secondary: "bg-[var(--hm-surface)] text-[var(--hm-text-secondary)] border border-[var(--hm-border)] hover:bg-[var(--hm-bg-secondary)] hover:border-[var(--hm-text-tertiary)] hover:text-[var(--hm-text)]",
  ghost: "bg-transparent text-[var(--hm-text-secondary)] border border-transparent hover:bg-[var(--hm-bg-tertiary)] hover:text-[var(--hm-text)]",
  danger: "bg-[var(--tag-red-bg)] text-[var(--tag-red-fg)] border border-transparent hover:brightness-95",
};
const SIZES: Record<Size, string> = {
  sm: "h-8 px-3 text-[12px] gap-1.5 rounded-lg",
  md: "h-9 px-4 text-[13px] gap-2 rounded-lg",
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = "primary", size = "md", loading, leftIcon, rightIcon, disabled, className = "", children, ...props }, ref
) {
  return (
    <button
      ref={ref}
      disabled={disabled || loading}
      className={
        "inline-flex items-center justify-center font-medium whitespace-nowrap transition-colors " +
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--hm-link)] focus-visible:ring-offset-1 " +
        "disabled:opacity-50 disabled:pointer-events-none " +
        SIZES[size] + " " + VARIANTS[variant] + " " + className
      }
      {...props}
    >
      {loading ? <Spinner size={size === "sm" ? 13 : 15} /> : leftIcon}
      {children}
      {!loading && rightIcon}
    </button>
  );
});
