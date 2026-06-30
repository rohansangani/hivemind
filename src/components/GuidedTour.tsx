"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { useRouter } from "next/navigation";
import type { TourDef, TourStep } from "@/lib/tours";

interface GuidedTourProps {
  tour: TourDef;
  onComplete: (tourId: string) => void;
  onDismiss: (tourId: string) => void;
}

interface TooltipPos {
  top: number;
  left: number;
  cutout: { top: number; left: number; width: number; height: number } | null;
}

export default function GuidedTour({ tour, onComplete, onDismiss }: GuidedTourProps) {
  const router = useRouter();
  const [step, setStep] = useState(0);
  const [pos, setPos] = useState<TooltipPos>({ top: 0, left: 0, cutout: null });
  const [visible, setVisible] = useState(false);
  const tooltipRef = useRef<HTMLDivElement>(null);

  const currentStep = tour.steps[step];
  const isLast = step === tour.steps.length - 1;

  const positionTooltip = useCallback(() => {
    if (!currentStep) return;
    const el = document.querySelector(currentStep.target);
    if (!el) {
      setPos({ top: window.innerHeight / 2 - 100, left: window.innerWidth / 2 - 180, cutout: null });
      setVisible(true);
      return;
    }

    const rect = el.getBoundingClientRect();
    const pad = 8;
    const cutout = {
      top: rect.top - pad,
      left: rect.left - pad,
      width: rect.width + pad * 2,
      height: rect.height + pad * 2,
    };

    const tooltipW = 360;
    const tooltipH = 200;
    const gap = 12;

    let top = rect.top + rect.height / 2 - tooltipH / 2;
    let left = rect.right + gap;

    const placement = currentStep.position || "right";
    if (placement === "left") {
      left = rect.left - tooltipW - gap;
    } else if (placement === "bottom") {
      top = rect.bottom + gap;
      left = rect.left + rect.width / 2 - tooltipW / 2;
    } else if (placement === "top") {
      top = rect.top - tooltipH - gap;
      left = rect.left + rect.width / 2 - tooltipW / 2;
    }

    // Keep within viewport
    if (left + tooltipW > window.innerWidth - 16) left = window.innerWidth - tooltipW - 16;
    if (left < 16) left = 16;
    if (top + tooltipH > window.innerHeight - 16) top = window.innerHeight - tooltipH - 16;
    if (top < 16) top = 16;

    setPos({ top, left, cutout });
    setVisible(true);
  }, [currentStep]);

  useEffect(() => {
    setVisible(false);
    const timer = setTimeout(positionTooltip, 150);
    window.addEventListener("resize", positionTooltip);
    return () => {
      clearTimeout(timer);
      window.removeEventListener("resize", positionTooltip);
    };
  }, [step, positionTooltip]);

  const handleNext = () => {
    if (isLast) {
      onComplete(tour.id);
    } else {
      setStep(s => s + 1);
    }
  };

  const handleTryIt = () => {
    if (currentStep?.action?.href) {
      router.push(currentStep.action.href);
    }
    handleNext();
  };

  const handleSkip = () => {
    onDismiss(tour.id);
  };

  if (!currentStep) return null;

  return (
    <div className="fixed inset-0 z-[9999]" style={{ pointerEvents: "auto" }}>
      {/* Overlay with cutout */}
      <svg className="absolute inset-0 w-full h-full" style={{ pointerEvents: "none" }}>
        <defs>
          <mask id="tour-mask">
            <rect width="100%" height="100%" fill="white" />
            {pos.cutout && (
              <rect
                x={pos.cutout.left}
                y={pos.cutout.top}
                width={pos.cutout.width}
                height={pos.cutout.height}
                rx="8"
                fill="black"
              />
            )}
          </mask>
        </defs>
        <rect
          width="100%"
          height="100%"
          fill="rgba(0,0,0,0.55)"
          mask="url(#tour-mask)"
          style={{ pointerEvents: "auto" }}
          onClick={handleSkip}
        />
      </svg>

      {/* Cutout highlight ring */}
      {pos.cutout && (
        <div
          className="absolute rounded-lg ring-2 ring-[#4361ee] ring-offset-2"
          style={{
            top: pos.cutout.top,
            left: pos.cutout.left,
            width: pos.cutout.width,
            height: pos.cutout.height,
            pointerEvents: "none",
          }}
        />
      )}

      {/* Tooltip */}
      <div
        ref={tooltipRef}
        className={`absolute w-[360px] rounded-xl border border-[#e2e4e9] shadow-2xl transition-all duration-200 ${visible ? "opacity-100 scale-100" : "opacity-0 scale-95"}`}
        style={{ background: "#ffffff", top: pos.top, left: pos.left, pointerEvents: "auto" }}
      >
        {/* Header */}
        <div className="px-5 pt-4 pb-2">
          <div className="flex items-center justify-between mb-1">
            <span className="text-[10px] font-medium text-[#4361ee] uppercase tracking-wider">{tour.name}</span>
            <span className="text-[10px] text-[var(--hm-text-tertiary)]">{step + 1} of {tour.steps.length}</span>
          </div>
          <h3 className="text-[15px] font-semibold text-[var(--hm-text-primary)]">{currentStep.title}</h3>
        </div>

        {/* Body */}
        <div className="px-5 pb-3">
          <p className="text-[13px] text-[var(--hm-text-secondary)] leading-relaxed">{currentStep.description}</p>
        </div>

        {/* Progress dots */}
        {tour.steps.length > 1 && (
          <div className="flex justify-center gap-1.5 pb-3">
            {tour.steps.map((_, i) => (
              <div
                key={i}
                className={`w-1.5 h-1.5 rounded-full transition-colors ${i === step ? "bg-[#4361ee]" : i < step ? "bg-[#4361ee]/40" : "bg-[var(--hm-border)]"}`}
              />
            ))}
          </div>
        )}

        {/* Actions */}
        <div className="flex items-center justify-between px-5 pb-4">
          <button
            onClick={handleSkip}
            className="text-[12px] text-[var(--hm-text-tertiary)] hover:text-[var(--hm-text-secondary)] transition-colors"
          >
            Skip tour
          </button>
          <div className="flex gap-2">
            {currentStep.action && (
              <button
                onClick={handleTryIt}
                className="h-[32px] px-4 border border-[#4361ee]/30 text-[#4361ee] rounded-lg text-[12px] font-medium hover:bg-[#4361ee]/5 transition-colors"
              >
                {currentStep.action.label}
              </button>
            )}
            <button
              onClick={handleNext}
              className="h-[32px] px-4 bg-[#4361ee] text-white rounded-lg text-[12px] font-medium hover:opacity-90 active:scale-[0.97] transition-all"
            >
              {isLast ? "Done" : "Next"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
