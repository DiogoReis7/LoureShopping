import { createFileRoute, Link } from "@tanstack/react-router";
import { RouteError, RouteNotFound, pageHead } from "@/components/RouteBoundary";
import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { ymd } from "@/lib/domain";
import { Megaphone, Award, CalendarOff, X, Maximize2 } from "lucide-react";

export const Route = createFileRoute("/_authenticated/quiosque")({
  head: pageHead("Quiosque · PDS LoureShopping", "Ecrã simplificado de consulta rápida no chão da loja."),
  errorComponent: ({ error, reset }) => <RouteError error={error} reset={reset} />,
  notFoundComponent: () => <RouteNotFound />,
  component: QuiosquePage,
});

function useClock() {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 30_000);
    return () => clearInterval(t);
  }, []);
  return now;
}

function QuiosquePage() {
  const now = useClock();
  const hoje = ymd(now);

  const avisosQ = useQuery({
    queryKey: ["kiosk-avisos", hoje],
    refetchInterval: 60_000,
    queryFn: async () => {
      const { data, error } = await supabase.from("announcements").select("*")
        .eq("ativo", true).order("created_at", { ascending: false }).limit(6);
      if (error) throw error;
      return (data ?? []).filter((a) => !a.expira_em || a.expira_em >= hoje);
    },
  });

  const empsQ = useQuery({
    queryKey: ["employees"],
    queryFn: async () =>
      (await supabase.from("employees").select("id,nome,slug,username_sgf,categoria,ativo,ordem").eq("ativo", true).order("ordem")).data ?? [],
  });

  const ausQ = useQuery({
    queryKey: ["kiosk-ausencias", hoje],
    refetchInterval: 120_000,
    queryFn: async () =>
      (await supabase.from("absences").select("*").lte("data_inicio", hoje).gte("data_fim", hoje)).data ?? [],
  });

  const badgesQ = useQuery({
    queryKey: ["kiosk-badges"],
    refetchInterval: 300_000,
    queryFn: async () => {
      const [{ data: eb }, { data: b }] = await Promise.all([
        supabase.from("employee_badges").select("*").order("data", { ascending: false }).limit(8),
        supabase.from("badges").select("*"),
      ]);
      const byId = new Map((b ?? []).map((x) => [x.id, x]));
      return (eb ?? []).map((x) => ({ ...x, badge: byId.get(x.badge_id) }));
    },
  });

  const nomes = useMemo(() => new Map((empsQ.data ?? []).map((e) => [e.id, e.nome])), [empsQ.data]);

  return (
    <div className="min-h-screen bg-background p-4 md:p-8">
      <header className="mb-6 flex flex-wrap items-center gap-3">
        <div>
          <h1 className="text-2xl md:text-4xl font-extrabold tracking-tight">
            <span className="neon-text" style={{ color: "var(--neon-blue)" }}>Quiosque</span>
            <span className="text-foreground/70"> · Loures</span>
          </h1>
          <p className="text-sm text-muted-foreground">
            {now.toLocaleDateString("pt-PT", { weekday: "long", day: "2-digit", month: "long" })} ·{" "}
            {now.toLocaleTimeString("pt-PT", { hour: "2-digit", minute: "2-digit" })}
          </p>
        </div>
        <div className="ml-auto flex items-center gap-2">
          <button
            onClick={() => document.documentElement.requestFullscreen?.()}
            className="inline-flex items-center gap-1.5 rounded-md border px-3 py-2 text-sm hover:bg-muted"
          >
            <Maximize2 className="h-4 w-4" /> Ecrã inteiro
          </button>
          <Link to="/" className="inline-flex items-center gap-1.5 rounded-md border px-3 py-2 text-sm hover:bg-muted">
            <X className="h-4 w-4" /> Sair
          </Link>
        </div>
      </header>

      <div className="grid gap-4 lg:grid-cols-2">
        <section className="rounded-2xl border bg-card p-5">
          <h2 className="mb-3 flex items-center gap-2 text-lg font-bold">
            <Megaphone className="h-5 w-5" style={{ color: "var(--neon-pink)" }} /> Avisos
          </h2>
          {(avisosQ.data ?? []).length === 0 ? (
            <p className="text-sm text-muted-foreground">Sem avisos ativos.</p>
          ) : (
            <ul className="space-y-3">
              {(avisosQ.data ?? []).map((a) => (
                <li key={a.id} className="rounded-lg border p-3">
                  <p className="text-base font-semibold">{a.titulo}</p>
                  {a.corpo && <p className="mt-1 whitespace-pre-wrap text-sm text-foreground/80">{a.corpo}</p>}
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="rounded-2xl border bg-card p-5">
          <h2 className="mb-3 flex items-center gap-2 text-lg font-bold">
            <CalendarOff className="h-5 w-5" style={{ color: "var(--neon-yellow)" }} /> Ausências de hoje
          </h2>
          {(ausQ.data ?? []).length === 0 ? (
            <p className="text-sm text-muted-foreground">Equipa completa hoje.</p>
          ) : (
            <ul className="space-y-2">
              {(ausQ.data ?? []).map((a) => (
                <li key={a.id} className="flex items-center gap-2 text-sm">
                  <span className="font-medium">{nomes.get(a.employee_id) ?? "—"}</span>
                  <span className="capitalize text-muted-foreground">· {a.tipo}</span>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="rounded-2xl border bg-card p-5">
          <h2 className="mb-3 flex items-center gap-2 text-lg font-bold">
            <Award className="h-5 w-5" style={{ color: "var(--neon-violet)" }} /> Conquistas recentes
          </h2>
          {(badgesQ.data ?? []).length === 0 ? (
            <p className="text-sm text-muted-foreground">Ainda sem conquistas atribuídas.</p>
          ) : (
            <ul className="space-y-2">
              {(badgesQ.data ?? []).map((eb) => (
                <li key={eb.id} className="flex items-center gap-2 text-sm">
                  <Award className="h-4 w-4" style={{ color: eb.badge?.cor ?? "var(--neon-yellow)" }} />
                  <span className="font-medium">{nomes.get(eb.employee_id) ?? "—"}</span>
                  <span className="text-muted-foreground">· {eb.badge?.nome ?? ""}</span>
                  <span className="ml-auto text-xs text-muted-foreground">{eb.data}</span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}
