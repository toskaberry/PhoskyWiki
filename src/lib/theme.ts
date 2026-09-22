/** Shared by the pre-paint script and the reader's theme control. */
export const THEME_STORAGE_KEY = "phoskywiki:theme";

export type Theme = "light" | "dark";

// Runs synchronously in <head>, before content can paint. Never follow the OS:
// a reader without a saved preference starts in the publication's light theme.
export const themeInitScript = `(()=>{try{document.documentElement.classList.toggle("dark",localStorage.getItem("${THEME_STORAGE_KEY}")==="dark")}catch{}})()`;

export function getTheme(): Theme {
  return document.documentElement.classList.contains("dark") ? "dark" : "light";
}

export function getServerTheme(): Theme {
  return "light";
}

export function setTheme(theme: Theme) {
  document.documentElement.classList.toggle("dark", theme === "dark");
  try {
    localStorage.setItem(THEME_STORAGE_KEY, theme);
  } catch {
    // The DOM remains the current page's source of truth when storage is denied.
  }
}

export function subscribeTheme(onChange: () => void) {
  const observer = new MutationObserver(onChange);
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
  return () => observer.disconnect();
}
