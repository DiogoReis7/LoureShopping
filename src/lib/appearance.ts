import { applyTheme, getTheme, setThemeForUser, type ThemeId } from "@/lib/theme";

export type ColorMode = "light" | "dark" | "system";
export type TextScale = 100 | 110 | 120 | 130;

export type Appearance = {
  mode: ColorMode;
  /** Tema escuro preferido (usado quando o modo é escuro/sistema). */
  darkTheme: ThemeId;
  textScale: TextScale;
  highContrast: boolean;
  reduceMotion: boolean;
};

const KEY = "ls-appearance";

export const DEFAULT_APPEARANCE: Appearance = {
  mode: "dark",
  darkTheme: "neon",
  textScale: 100,
  highContrast: false,
  reduceMotion: false,
};

export function readAppearance(): Appearance {
  if (typeof window === "undefined") return DEFAULT_APPEARANCE;
  try {
    const raw = localStorage.getItem(KEY);
    const stored = getTheme(null);
    const base: Appearance = {
      ...DEFAULT_APPEARANCE,
      mode: stored === "light" ? "light" : "dark",
      darkTheme: stored === "light" ? "neon" : stored,
    };
    if (!raw) return base;
    const p = JSON.parse(raw) as Partial<Appearance>;
    return {
      mode: p.mode ?? base.mode,
      darkTheme: p.darkTheme ?? base.darkTheme,
      textScale: (p.textScale as TextScale) ?? DEFAULT_APPEARANCE.textScale,
      highContrast: p.highContrast ?? false,
      reduceMotion: p.reduceMotion ?? false,
    };
  } catch {
    return DEFAULT_APPEARANCE;
  }
}

export function writeAppearance(a: Appearance, sync = true) {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(KEY, JSON.stringify(a));
  } catch {}
  if (sync) void import("@/lib/settings-sync").then((m) => m.pushAppearance(a));
}

export function systemPrefersDark(): boolean {
  if (typeof window === "undefined" || !window.matchMedia) return true;
  return window.matchMedia("(prefers-color-scheme: dark)").matches;
}

export function resolvedThemeId(a: Appearance): ThemeId {
  if (a.mode === "light") return "light";
  if (a.mode === "dark") return a.darkTheme === "light" ? "neon" : a.darkTheme;
  return systemPrefersDark() ? (a.darkTheme === "light" ? "neon" : a.darkTheme) : "light";
}

export function applyAppearance(a: Appearance, userId?: string | null) {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  const theme = resolvedThemeId(a);
  applyTheme(theme);
  if (userId !== undefined) setThemeForUser(userId ?? null, theme);
  root.style.setProperty("--app-text-scale", `${a.textScale}%`);
  root.setAttribute("data-contrast", a.highContrast ? "alto" : "normal");
  root.setAttribute("data-motion", a.reduceMotion ? "reduzido" : "normal");
}
