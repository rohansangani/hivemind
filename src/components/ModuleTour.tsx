"use client";

import { useEffect, useState } from "react";
import GuidedTour from "./GuidedTour";
import { getModuleTour, type TourDef } from "@/lib/tours";

/**
 * Level-2 tour trigger. Drop `<ModuleTour moduleId="content-generator" />` into a
 * module page and, on the user's FIRST visit to that module, it fires the
 * matching per-module walkthrough (anchored to in-page elements) once — then
 * records completion so it never shows again.
 *
 * Self-contained on purpose: each page mounts one, checks its own progress, and
 * writes back via /api/onboarding. A sessionStorage cache means repeat visits in
 * the same session skip the network check entirely.
 */

const SEEN_KEY = "hm-module-tours-done";

function readSeen(): string[] {
  try { return JSON.parse(sessionStorage.getItem(SEEN_KEY) || "[]"); } catch { return []; }
}
function markSeen(tourId: string) {
  try {
    const seen = readSeen();
    if (!seen.includes(tourId)) sessionStorage.setItem(SEEN_KEY, JSON.stringify([...seen, tourId]));
  } catch { /* sessionStorage unavailable — non-fatal */ }
}

export default function ModuleTour({ moduleId }: { moduleId: string }) {
  const [tour, setTour] = useState<TourDef | null>(null);

  useEffect(() => {
    const def = getModuleTour(moduleId);
    if (!def) return;
    if (readSeen().includes(def.id)) return; // already handled this session

    let cancelled = false;
    fetch("/api/onboarding")
      .then(r => r.json())
      .then(data => {
        if (cancelled) return;
        const done: string[] = (data.progress || [])
          .filter((p: { status: string }) => p.status === "completed" || p.status === "dismissed")
          .map((p: { tourId: string }) => p.tourId);
        if (done.includes(def.id)) { markSeen(def.id); return; }
        // Delay so the page's anchor elements have mounted before we measure them.
        setTimeout(() => { if (!cancelled) setTour(def); }, 700);
      })
      .catch(() => { /* offline / error — just don't show the tour */ });

    return () => { cancelled = true; };
  }, [moduleId]);

  const finish = (status: "completed" | "dismissed") => {
    if (tour) markSeen(tour.id);
    const id = tour?.id;
    setTour(null);
    if (id) {
      fetch("/api/onboarding", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tourId: id, status }),
      }).catch(() => {});
    }
  };

  if (!tour) return null;
  return (
    <GuidedTour
      tour={tour}
      onComplete={() => finish("completed")}
      onDismiss={() => finish("dismissed")}
    />
  );
}
