export type ThemeId = "neon" | "midnight" | "oceano" | "ambar" | "light";

/** Temas de cor (modo escuro) selecionáveis. "light" fica de fora deste
 *  leque — é gerido à parte pelo alternador Claro/Escuro/Sistema. */
export const THEMES: { id: ThemeId; label: string; swatch: string[] }[] = [
  { id: "neon",     label: "NOS",      swatch: ["#38bdf8", "#f472b6", "#5eead4", "#0b0f1c"] },
  { id: "midnight", label: "Midnight", swatch: ["#93c5fd", "#c4b5fd", "#67e8f9", "#0a0a1a"] },
  { id: "oceano",   label: "Oceano",   swatch: ["#22d3ee", "#2dd4bf", "#60a5fa", "#06151c"] },
  { id: "ambar",    label: "Âmbar",    swatch: ["#fbbf24", "#fb923c", "#f87171", "#1a1208"] },
  { id: "light",    label: "Claro",    swatch: ["#3b82f6", "#ec4899", "#10b981", "#f8fafc"] },
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
