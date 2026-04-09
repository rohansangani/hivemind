"use client";

import { useEffect, useState } from "react";

export type Theme = "light" | "dark" | "system";

function applyTheme(theme: Theme) {
  const html = document.documentElement;
  html.classList.remove("light", "dark");
  if (theme === "light") html.classList.add("light");
  else if (theme === "dark") html.classList.add("dark");
  // "system" — no class, falls back to @media query
}

export function useTheme() {
  const [theme, setThemeState] = useState<Theme>("system");

  useEffect(() => {
    try {
      const saved = localStorage.getItem("hm-theme") as Theme | null;
      if (saved === "light" || saved === "dark" || saved === "system") {
        setThemeState(saved);
      }
    } catch {}
  }, []);

  const setTheme = (t: Theme) => {
    setThemeState(t);
    applyTheme(t);
    try {
      if (t === "system") localStorage.removeItem("hm-theme");
      else localStorage.setItem("hm-theme", t);
    } catch {}
  };

  return { theme, setTheme };
}
