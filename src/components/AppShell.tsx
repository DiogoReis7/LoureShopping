import { Link, useRouterState, useNavigate } from "@tanstack/react-router";
import { useCallback, useEffect, useState, type ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";

import {
  ClipboardList, Users, Package,
  Calculator, Ticket, UserCircle, Menu, ChevronLeft, BarChart3, CalendarClock,
  Lock, LogOut, Home, Search, Trophy, Plus, WifiOff, HeartHandshake, Activity, ShieldCheck, Coffee,
  CalendarOff, Megaphone, Medal, MessagesSquare, MonitorSmartphone, Settings,
} from "lucide-react";
import { classNames } from "@/lib/domain";
import { useIsAdmin } from "@/hooks/use-is-admin";
import { useOnlineStatus } from "@/hooks/use-online-status";
import { useRealtimeSync } from "@/hooks/useRealtimeSync";
import { useAuth } from "@/hooks/use-auth";
import { useSessionExpiry } from "@/hooks/use-session-expiry";
import { supabase } from "@/integrations/supabase/client";
import { ThemeSwitcher, useThemeBoot } from "@/components/ThemeSwitcher";
import { ColorModeButton } from "@/components/AppearanceSettings";
import { useAppearanceBoot } from "@/hooks/use-appearance";
import { useSettingsSync } from "@/hooks/use-settings-sync";
import { CommandPalette, useCommandPalette } from "@/components/CommandPalette";
import { useNpsAlert } from "@/hooks/use-nps-alert";
import { useDailyReminders, pedirPermissaoNotificacoes } from "@/hooks/use-daily-reminders";
import { AnnouncementsBanner } from "@/components/AnnouncementsBanner";
import nosLogo from "@/assets/nos-logo.png.asset.json";
import lojaLogo from "@/assets/loures-shopping.jpg.asset.json";

type NavItem = { to: string; label: string; icon: typeof BarChart3 };
type NavGroup = { id: string; label: string; items: NavItem[] };

/** Atalhos sempre visíveis no topo do menu. */
const PRIMARY: NavItem[] = [
  { to: "/", label: "Início", icon: Home },
  { to: "/pds", label: "PDS", icon: BarChart3 },
  { to: "/individual", label: "Individuais", icon: UserCircle },
  { to: "/desafios", label: "Desafios", icon: Trophy },
  { to: "/avisos", label: "Avisos", icon: Megaphone },
];

const GROUPS: NavGroup[] = [
  {
    id: "operacao",
    label: "Operação",
    items: [
      { to: "/contador", label: "Contador", icon: Calculator },
      { to: "/sgf", label: "SGF", icon: Ticket },
      { to: "/ociosidade", label: "Ociosidade", icon: Coffee },
      { to: "/quadro-ios", label: "Quadro IOS", icon: ClipboardList },
      { to: "/quiosque", label: "Quiosque", icon: MonitorSmartphone },
    ],
  },
  {
    id: "equipa",
    label: "Equipa",
    items: [
      { to: "/colaboradores", label: "Vendedores", icon: Users },
      { to: "/horarios", label: "Horários", icon: CalendarClock },
      { to: "/ausencias", label: "Ausências", icon: CalendarOff },
      { to: "/reunioes", label: "Reuniões 1:1", icon: MessagesSquare },
      { to: "/conquistas", label: "Conquistas", icon: Medal },
    ],
  },
  {
    id: "dados",
    label: "Dados",
    items: [
      { to: "/desempenho", label: "Desempenho", icon: Activity },
      
      { to: "/nps", label: "NPS", icon: HeartHandshake },
      { to: "/produtos", label: "Produtos", icon: Package },
      { to: "/pesquisa", label: "Pesquisa", icon: Search },
      { to: "/configuracoes", label: "Configurações", icon: Settings },
    ],
  },
];

const ADMIN_NAV: NavItem[] = [
  { to: "/admin", label: "Contas", icon: ShieldCheck },
];


const MOBILE_BAR: NavItem[] = [
  { to: "/", label: "Início", icon: Home },
  { to: "/pds", label: "PDS", icon: BarChart3 },
  { to: "/individual", label: "Indiv.", icon: UserCircle },
  { to: "/desafios", label: "Desafios", icon: Trophy },
  { to: "/sgf", label: "SGF", icon: Ticket },
];


function Brand({ compact = false }: { compact?: boolean }) {
  return (
    <div className="flex items-center gap-2 min-w-0">
      <div
        className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-black ring-1 ring-[var(--neon-blue)]/60"
        style={{ boxShadow: "0 0 14px color-mix(in oklab, var(--neon-blue) 45%, transparent)" }}
        aria-label="NOS"
      >
        <img src={nosLogo.url} alt="NOS" className="h-5 w-auto invert" />
      </div>
      {!compact && (
        <div className="min-w-0 leading-tight">
          <div className="text-sm font-bold tracking-wide truncate">
            <span style={{ color: "var(--neon-blue)" }} className="neon-text">NOS</span>
            <span className="text-foreground/70"> · Loures</span>
          </div>
          <div className="text-[10px] text-muted-foreground truncate">LoureShopping</div>
        </div>
      )}
    </div>
  );
}

function LiveDot({ status, label = true }: { status: "connecting" | "live" | "offline"; label?: boolean }) {
  const cfg = {
    live: { color: "#22c55e", text: "Ao vivo", title: "Atualizações em tempo real ativas" },
    connecting: { color: "#f59e0b", text: "A ligar…", title: "A restabelecer ligação em tempo real" },
    offline: { color: "#ef4444", text: "Sem sinc.", title: "Sem ligação em tempo real — a tentar reconectar" },
  }[status];
  return (
    <span
      title={cfg.title}
      aria-label={cfg.title}
      className="inline-flex items-center gap-1.5 text-[10px] font-semibold text-muted-foreground"
    >
      <span
        className={classNames("h-2 w-2 rounded-full", status !== "live" && "animate-pulse")}
        style={{ background: cfg.color, boxShadow: `0 0 8px ${cfg.color}` }}
      />
      {label && <span>{cfg.text}</span>}
    </span>
  );
}

function NavLink({ item, collapsed, pathname, badge }: { item: NavItem; collapsed: boolean; pathname: string; badge: number }) {
  const active = item.to === "/" ? pathname === "/" : (pathname === item.to || pathname.startsWith(item.to + "/"));
  const Icon = item.icon;
  return (
    <Link
      to={item.to}
      className={classNames(
        "group relative flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors focus-neon",
        active
          ? "bg-sidebar-primary text-sidebar-primary-foreground shadow-[0_0_14px_color-mix(in_oklab,var(--neon-blue)_45%,transparent)]"
          : "text-sidebar-foreground/90 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground hover:ring-1 hover:ring-[var(--neon-blue)]/35",
      )}
      title={collapsed ? item.label : undefined}
    >
      {active && (
        <span
          aria-hidden
          className="pointer-events-none absolute left-0 top-1/2 -translate-y-1/2 h-5 w-0.5 rounded-r"
          style={{ background: "var(--neon-blue)", boxShadow: "0 0 10px var(--neon-blue)" }}
        />
      )}
      <Icon className={classNames("h-4 w-4 shrink-0 transition-transform group-hover:scale-110", active && "neon-glow")} />
      {!collapsed && <span className="truncate">{item.label}</span>}
      {badge > 0 && (
        <span
          className={classNames(
            "ml-auto grid min-w-[18px] place-items-center rounded-full px-1 text-[10px] font-bold text-black",
            collapsed && "absolute right-1 top-1 ml-0",
          )}
          style={{ background: "var(--neon-pink)", boxShadow: "0 0 10px color-mix(in oklab, var(--neon-pink) 60%, transparent)" }}
          aria-label={`${badge} por ver`}
        >
          {badge}
        </span>
      )}
    </Link>
  );
}

export function AppShell({ children }: { children: ReactNode }) {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const qc = useQueryClient();

  const navigate = useNavigate();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const [signedIn, setSignedIn] = useState(false);
  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>({});
  const isAdmin = useIsAdmin();
  const online = useOnlineStatus();
  const { user } = useAuth();
  const { open: paletteOpen, setOpen: setPaletteOpen } = useCommandPalette();
  const npsAlert = useNpsAlert();
  const npsCount = npsAlert.data?.rows?.length ?? 0;
  const rtStatus = useRealtimeSync();
  const irParaAvisos = useCallback(() => { navigate({ to: "/avisos" }); }, [navigate]);
  const { avisosPorLer } = useDailyReminders(irParaAvisos);
  useSessionExpiry(useCallback(() => {
    navigate({ to: "/auth", replace: true });
  }, [navigate]));
  useThemeBoot(user?.id ?? null);
  useAppearanceBoot();
  useSettingsSync(user?.id ?? null);

  useEffect(() => { setSidebarOpen(false); }, [pathname]);

  useEffect(() => {
    if (!user?.id) return;
    const t = setTimeout(() => { void pedirPermissaoNotificacoes(); }, 4000);
    return () => clearTimeout(t);
  }, [user?.id]);



  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSignedIn(!!data.session));
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => setSignedIn(!!s));
    return () => sub.subscription.unsubscribe();
  }, []);

  async function handleSignOut() {
    await qc.cancelQueries();
    qc.clear();
    await supabase.auth.signOut();
    navigate({ to: "/auth", replace: true });
  }



  const sidebar = (
    <aside
      className={classNames(
        "flex h-full flex-col bg-sidebar/85 backdrop-blur-xl text-sidebar-foreground border-r",
        collapsed ? "w-16" : "w-60",
        "transition-[width] duration-200",
      )}
    >
      <div className="flex h-14 items-center gap-2 px-3 border-b">
        <Brand compact={collapsed} />
        {!collapsed && <LiveDot status={rtStatus} />}
        <button
          onClick={() => setCollapsed((v) => !v)}
          className="ml-auto hidden lg:grid h-7 w-7 place-items-center rounded-md hover:bg-sidebar-accent"
          aria-label="Colapsar"
        >
          <ChevronLeft className={classNames("h-4 w-4 transition-transform", collapsed && "rotate-180")} />
        </button>
      </div>
      <nav className="flex-1 overflow-y-auto p-2 space-y-0.5">
        {PRIMARY.map((item) => (
          <NavLink key={item.to} item={item} collapsed={collapsed} pathname={pathname}
            badge={item.to === "/avisos" ? avisosPorLer : 0} />
        ))}

        {GROUPS.map((g) => {
          const temAtivo = g.items.some((i) => pathname === i.to || pathname.startsWith(i.to + "/"));
          const aberto = openGroups[g.id] ?? temAtivo;
          return (
            <div key={g.id} className="pt-1">
              {!collapsed && (
                <button
                  onClick={() => setOpenGroups((s) => ({ ...s, [g.id]: !aberto }))}
                  className="flex w-full items-center gap-2 rounded-md px-3 py-1.5 text-[11px] font-bold uppercase tracking-wide text-muted-foreground hover:bg-sidebar-accent"
                  aria-expanded={aberto}
                >
                  <span>{g.label}</span>
                  <ChevronLeft className={classNames("ml-auto h-3.5 w-3.5 transition-transform", aberto ? "-rotate-90" : "rotate-0")} />
                </button>
              )}
              {(aberto || collapsed) && g.items.map((item) => (
                <NavLink key={item.to} item={item} collapsed={collapsed} pathname={pathname}
                  badge={item.to === "/nps" ? npsCount : 0} />
              ))}
            </div>
          );
        })}

        {isAdmin && ADMIN_NAV.map((item) => (
          <NavLink key={item.to} item={item} collapsed={collapsed} pathname={pathname} badge={0} />
        ))}
      </nav>

      <div className="border-t p-2 space-y-1">
        <div className={classNames("flex", collapsed ? "justify-center" : "justify-between items-center px-1")}>
          {!collapsed && <span className="text-[11px] text-muted-foreground">Aparência</span>}
          <div className="flex items-center gap-1">
            <ColorModeButton compact />
            <ThemeSwitcher compact={collapsed} userId={user?.id ?? null} />
          </div>
        </div>
        {signedIn ? (
          <button
            onClick={handleSignOut}
            className="flex w-full items-center gap-3 rounded-md px-3 py-2 text-sm text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
            title={collapsed ? (isAdmin ? "Sair (Admin)" : "Sair") : undefined}
          >
            <LogOut className="h-4 w-4 shrink-0" />
            {!collapsed && <span className="truncate">{isAdmin ? "Sair (Admin)" : "Sair"}</span>}
          </button>
        ) : (
          <Link
            to="/auth"
            className="flex w-full items-center gap-3 rounded-md px-3 py-2 text-sm text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
            title={collapsed ? "Entrar" : undefined}
          >
            <Lock className="h-4 w-4 shrink-0" />
            {!collapsed && <span className="truncate">Entrar</span>}
          </Link>
        )}
        {!collapsed && (
          <div className="px-3 pt-1 text-[11px] text-muted-foreground">
            {signedIn ? (isAdmin ? "Modo admin" : "Loja Loures") : "Sem sessão"}
          </div>
        )}
      </div>
    </aside>
  );

  return (
    <div className="flex min-h-screen text-foreground">
      <div className="hidden md:block sticky top-0 h-screen shrink-0">{sidebar}</div>

      {sidebarOpen && (
        <div className="md:hidden fixed inset-0 z-50 flex">
          <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={() => setSidebarOpen(false)} />
          <div className="relative z-10 h-full">{sidebar}</div>
        </div>
      )}

      <div className="flex flex-1 flex-col min-w-0">
        <header className="md:hidden sticky top-0 z-30 flex h-14 items-center gap-2 border-b bg-background/95 px-3 backdrop-blur">
          <button
            onClick={() => setSidebarOpen(true)}
            className="grid h-9 w-9 place-items-center rounded-md hover:bg-accent"
            aria-label="Menu"
          >
            <Menu className="h-5 w-5" />
          </button>
          <Brand />
          <button
            onClick={() => setPaletteOpen(true)}
            className="ml-auto grid h-9 w-9 place-items-center rounded-md hover:bg-accent"
            aria-label="Pesquisa rápida"
          >
            <Search className="h-5 w-5" />
          </button>
          <LiveDot status={rtStatus} label={false} />
          <ColorModeButton compact />
          <ThemeSwitcher compact userId={user?.id ?? null} />
        </header>

        {!online && (
          <div
            role="status"
            className="sticky top-14 md:top-0 z-20 flex items-center justify-center gap-2 border-b border-amber-500/40 bg-amber-500/15 px-3 py-1.5 text-[11px] font-semibold text-amber-700 dark:text-amber-300"
          >
            <WifiOff className="h-3.5 w-3.5" />
            <span>Sem ligação — a mostrar os últimos dados guardados. As alterações sincronizam quando voltar a rede.</span>
          </div>
        )}

        <CommandPalette open={paletteOpen} onOpenChange={setPaletteOpen} />

        <div className="px-3 pt-3 md:px-6 empty:hidden">
          <AnnouncementsBanner />
        </div>

        <main className="flex-1 pb-24 md:pb-6">{children}</main>

        {/* FAB "+ Venda" mobile */}
        <Link
          to="/individual"
          aria-label="Nova venda"
          className="md:hidden fixed z-50 grid h-14 w-14 place-items-center rounded-full bg-[var(--neon-blue)] text-black shadow-[0_0_20px_color-mix(in_oklab,var(--neon-blue)_70%,transparent)] active:scale-95 transition"
          style={{ bottom: "calc(env(safe-area-inset-bottom, 0px) + 72px)", right: "16px" }}
        >
          <Plus className="h-7 w-7" strokeWidth={3} />
        </Link>

        <nav className="md:hidden fixed bottom-0 inset-x-0 z-40 border-t border-border bg-background/95 backdrop-blur" style={{ paddingBottom: "env(safe-area-inset-bottom, 0px)" }}>
          <div className="grid grid-cols-5">
            {MOBILE_BAR.map((item, idx) => {
              const active = item.to === "/" ? pathname === "/" : (pathname === item.to || pathname.startsWith(item.to + "/"));
              const Icon = item.icon;
              return (
                <Link
                  key={`${item.to}-${idx}`}
                  to={item.to}
                  className={classNames(
                    "relative flex flex-col items-center gap-1 py-2 text-[11px] font-semibold transition-colors focus-neon active:scale-95",
                    active ? "text-[var(--neon-blue)] neon-text" : "text-foreground/75 hover:text-foreground hover:bg-[color-mix(in_oklab,var(--neon-blue)_8%,transparent)]",
                  )}
                >
                  {active && (
                    <span
                      aria-hidden
                      className="pointer-events-none absolute inset-x-3 top-0 h-0.5 rounded-full"
                      style={{ background: "var(--neon-blue)", boxShadow: "0 0 10px var(--neon-blue)" }}
                    />
                  )}
                  <Icon className={classNames("h-5 w-5 transition-transform", active && "scale-110 neon-glow")} />
                  <span className="truncate">{item.label}</span>
                </Link>
              );
            })}
          </div>
        </nav>
      </div>
    </div>
  );
}

export function PageHeader({ title, subtitle, actions }: { title: string; subtitle?: string; actions?: ReactNode }) {
  return (
    <div
      className="relative flex flex-col gap-2 border-b px-3 py-2.5 md:grid md:grid-cols-[minmax(0,1fr)_auto] md:items-center md:gap-3 md:px-6 md:py-4"
      style={{
        background:
          "linear-gradient(90deg, color-mix(in oklab, var(--neon-blue) 14%, var(--background)) 0%, color-mix(in oklab, var(--neon-pink) 10%, var(--background)) 100%)",
      }}
    >
      <div
        className="pointer-events-none absolute inset-x-0 bottom-0 h-px"
        style={{ background: "linear-gradient(90deg, transparent, var(--neon-blue), var(--neon-pink), transparent)" }}
      />
      <div className="relative flex items-center gap-3 min-w-0">
        <img src={lojaLogo.url} alt="LoureShopping" className="h-8 w-8 md:h-10 md:w-10 rounded-md object-contain bg-white/90 p-1 shadow" />
        <div className="min-w-0">
          <h1 className="truncate text-base md:text-2xl font-extrabold tracking-tight">
            <span style={{ color: "var(--neon-blue)" }} className="neon-text">{title}</span>
          </h1>
          {subtitle && <p className="mt-0.5 truncate text-xs md:text-sm text-foreground/85">{subtitle}</p>}
        </div>
      </div>
      {actions && <div className="relative flex w-full flex-wrap items-center gap-1.5 overflow-x-auto md:w-auto md:overflow-visible md:shrink-0 md:justify-end md:gap-2 [&>*]:shrink-0">{actions}</div>}
    </div>
  );
}
