import { useEffect, useState } from "react";
import { Palette, Check, Pin, PinOff } from "lucide-react";
import { THEMES, type ThemeId, applyTheme, getTheme, setThemeForUser } from "@/lib/theme";
import { useUserPrefs } from "@/hooks/use-user-prefs";

export function useThemeBoot(userId?: string | null) {
  useEffect(() => { applyTheme(getTheme(userId)); }, [userId]);
}

export function ThemeSwitcher({ compact = false, userId }: { compact?: boolean; userId?: string | null }) {
  const [open, setOpen] = useState(false);
  const [current, setCurrent] = useState<ThemeId>("neon");
  const { prefs, setDefaultTheme } = useUserPrefs(userId ?? null);

  useEffect(() => { setCurrent(getTheme(userId)); }, [userId]);

  function pick(id: ThemeId) {
    applyTheme(id);
    setCurrent(id);
    setThemeForUser(userId ?? null, id);
    setOpen(false);
  }

  function saveAsDefault(id: ThemeId) {
    setDefaultTheme(id);
    applyTheme(id);
    setCurrent(id);
    setOpen(false);
  }

  const isDefault = (id: ThemeId) => prefs.defaultTheme === id;

  return (
    <div className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-2 rounded-md border bg-background/60 px-2 py-1.5 text-xs hover:bg-accent"
        aria-label="Tema"
        title="Mudar tema"
      >
        <Palette className="h-4 w-4" />
        {!compact && <span className="truncate">Tema</span>}
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="absolute right-0 bottom-full mb-2 z-50 w-60 rounded-lg border bg-popover p-1.5 shadow-xl">
            <div className="px-2 py-1 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Escolher tema</div>
            {THEMES.map((t) => (
              <div key={t.id} className="flex items-center gap-1">
                <button
                  onClick={() => pick(t.id)}
                  className="flex flex-1 items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs hover:bg-accent"
                >
                  <div className="flex h-5 w-5 shrink-0 overflow-hidden rounded">
                    {t.swatch.map((c, i) => (
                      <div key={i} className="flex-1" style={{ background: c }} />
                    ))}
                  </div>
                  <span className="flex-1 truncate">{t.label}</span>
                  {current === t.id && <Check className="h-3.5 w-3.5 text-primary" />}
                </button>
                <button
                  onClick={() => saveAsDefault(t.id)}
                  className={`rounded-md p-1.5 ${isDefault(t.id) ? "text-[var(--neon-yellow)]" : "text-muted-foreground hover:text-foreground"}`}
                  title={isDefault(t.id) ? "Tema predefinido" : "Definir como predefinido"}
                >
                  {isDefault(t.id) ? <Pin className="h-3.5 w-3.5" /> : <PinOff className="h-3.5 w-3.5" />}
                </button>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
