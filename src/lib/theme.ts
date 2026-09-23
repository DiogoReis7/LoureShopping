export type ThemeId = "neon" | "midnight" | "sunset" | "telecom" | "combina" | "light";

export const THEMES: { id: ThemeId; label: string; swatch: string[] }[] = [
  { id: "neon",     label: "Neon NOS",     swatch: ["#00c2ff", "#ff2e9a", "#39ff8a", "#0b0f1c"] },
  { id: "midnight", label: "Midnight",     swatch: ["#4f46e5", "#818cf8", "#22d3ee", "#0a0a1a"] },
  { id: "sunset",   label: "Sunset Loja",  swatch: ["#ff7a00", "#ff3b6a", "#ffe600", "#1a0f0a"] },
  { id: "telecom",  label: "Telecom 5G",   swatch: ["#00e0ff", "#7c5cff", "#00ffa3", "#050b1a"] },
  { id: "combina",  label: "NOS+GALP+Cnt", swatch: ["#00a3ff", "#00b85c", "#e30613", "#0a1224"] },
  { id: "light",    label: "Claro",        swatch: ["#3b82f6", "#ec4899", "#10b981", "#f8fafc"] },
];

const KEY = "ls-theme";

export function getTheme(userId?: string | null): ThemeId {
  if (typeof window === "undefined") return "neon";
  const userKey = userId ? `ls-theme-${userId}` : KEY;
  const fallback = localStorage.getItem(KEY) as ThemeId | null;
  return (localStorage.getItem(userKey) as ThemeId) || fallback || "neon";
}

export function setThemeForUser(userId: string | null, id: ThemeId) {
  if (typeof window === "undefined") return;
  const userKey = userId ? `ls-theme-${userId}` : KEY;
  localStorage.setItem(userKey, id);
}

export function applyTheme(id: ThemeId) {
  if (typeof document === "undefined") return;
  document.documentElement.setAttribute("data-theme", id);
  if (id === "light") {
    document.documentElement.classList.remove("dark");
  } else {
    document.documentElement.classList.add("dark");
  }
  try { localStorage.setItem(KEY, id); } catch {}
}
