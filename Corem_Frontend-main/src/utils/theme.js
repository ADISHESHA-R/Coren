const STORAGE_KEY = "corem-theme";

/** @returns {"light" | "dark" | null} */
export function getStoredTheme() {
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    if (v === "light" || v === "dark") return v;
  } catch {
    /* ignore */
  }
  return null;
}

/** @returns {"light" | "dark"} */
export function getSystemTheme() {
  if (typeof window === "undefined") return "light";
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

/**
 * @param {"light" | "dark"} theme
 * @param {{ persist?: boolean }} [opts] — set persist false on first load when following system (no saved choice yet)
 */
export function applyTheme(theme, { persist = true } = {}) {
  const root = document.documentElement;
  root.setAttribute("data-theme", theme);
  root.setAttribute("data-bs-theme", theme);
  const metaTheme = document.querySelector('meta[name="theme-color"]');
  if (metaTheme) {
    metaTheme.setAttribute("content", theme === "dark" ? "#121820" : "#0d6efd");
  }
  if (persist) {
    try {
      localStorage.setItem(STORAGE_KEY, theme);
    } catch {
      /* ignore */
    }
  }
}

/** Call before React render to avoid a flash of the wrong theme. */
export function initTheme() {
  const stored = getStoredTheme();
  const theme = stored ?? getSystemTheme();
  applyTheme(theme, { persist: Boolean(stored) });
}

/** @returns {"light" | "dark"} the new theme */
export function toggleTheme() {
  const current = document.documentElement.getAttribute("data-theme") === "dark" ? "dark" : "light";
  const next = current === "dark" ? "light" : "dark";
  applyTheme(next, { persist: true });
  return next;
}
