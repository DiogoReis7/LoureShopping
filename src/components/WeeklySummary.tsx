import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { CalendarRange, TrendingUp, Timer, Coffee, HeartHandshake, Settings2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { fmtNum, ymd, classNames } from "@/lib/domain";
import { fmtDur, computeIdle, type IdleTicket } from "@/lib/idle";
import { EXCLUDED, INDICATOR_ONLY_CODES } from "@/lib/challenges";
import { Skeleton } from "@/components/ui/skeleton";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Checkbox } from "@/components/ui/checkbox";
import { useAuth } from "@/hooks/use-auth";
import { useUserPrefs, WEEK_BLOCKS } from "@/hooks/use-user-prefs";

type Emp = { id: string; nome: string; slug: string };

function weekRange(base = new Date()) {
  const d = new Date(base);
  const dow = (d.getDay() + 6) % 7; // 0 = segunda
  const start = new Date(d.getFullYear(), d.getMonth(), d.getDate() - dow);
  const end = new Date(start.getFullYear(), start.getMonth(), start.getDate() + 6);
  return { start: ymd(start), end: ymd(end) };
}

function surveyNota(s: { tipo: string | null; nota_global: number | null; nota_pessoa: number | null }) {
  const tipo = (s.tipo ?? "").toLowerCase();
  return tipo === "venda" ? (s.nota_pessoa ?? s.nota_global) : (s.nota_global ?? s.nota_pessoa);
}

type Row = { emp: Emp; pts: number; tma: number | null; idle: number | null; det: number | null; inq: number };

/** Resumo da semana: melhores e piores em pontos, TMA, ociosidade e detratores. */
export function WeeklySummary() {
  const { start, end } = weekRange();
  const { user } = useAuth();
  const { prefs, toggleWeekBlock, setWeekTopN, setWeekShowBottom } = useUserPrefs(user?.id ?? null);



  const empQ = useQuery({
    queryKey: ["week-emps"],
    queryFn: async () => {
      const { data } = await supabase.from("employees").select("id,nome,slug").eq("ativo", true).order("ordem");
      return (data ?? []) as Emp[];
    },
  });

  const salesQ = useQuery({
    queryKey: ["week-sales", start, end],
    queryFn: async () => {
      const { data } = await supabase
        .from("sales_entries")
        .select("employee_id,quantidade,products(codigo,peso)")
        .gte("data", start).lte("data", end);
      return (data ?? []).map((s: any) => ({
        employee_id: s.employee_id as string,
        q: Number(s.quantidade) || 0,
        codigo: String(s.products?.codigo ?? "").toLowerCase(),
        peso: Number(s.products?.peso) || 0,
      }));
    },
  });

  const tkQ = useQuery({
    queryKey: ["week-tickets", start, end],
    queryFn: async () => {
      const { data } = await supabase
        .from("sgf_tickets")
        .select("employee_id,emitida_em,inicio_em,fim_em,estado,espera_s,atendimento_s")
        .gte("emitida_em", `${start}T00:00:00`).lte("emitida_em", `${end}T23:59:59`);
      return (data ?? []) as (IdleTicket & { atendimento_s: number | null })[];
    },
  });

  // Detratores: baseado no último import (snapshot), não na semana.
  const snapQ = useQuery({
    queryKey: ["week-nps-snapshot"],
    queryFn: async () => {
      const { data } = await supabase
        .from("nps_snapshots")
        .select("id,label,created_at")
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      return (data ?? null) as { id: string; label: string; created_at: string } | null;
    },
  });
  const snapId = snapQ.data?.id ?? null;

  const npsQ = useQuery({
    enabled: !!snapId,
    queryKey: ["week-nps", snapId],
    queryFn: async () => {
      const { data } = await supabase
        .from("nps_surveys")
        .select("employee_id,tipo,nota_global,nota_pessoa")
        .eq("snapshot_id", snapId!);
      return (data ?? []) as { employee_id: string | null; tipo: string | null; nota_global: number | null; nota_pessoa: number | null }[];
    },
  });


  const rows = useMemo<Row[]>(() => {
    const emps = empQ.data ?? [];
    const pts = new Map<string, number>();
    for (const s of salesQ.data ?? []) {
      if (EXCLUDED.has(s.codigo) || INDICATOR_ONLY_CODES.has(s.codigo)) continue;
      pts.set(s.employee_id, (pts.get(s.employee_id) ?? 0) + s.q * s.peso);
    }

    const tk = tkQ.data ?? [];
    const tma = new Map<string, { sum: number; n: number }>();
    for (const t of tk) {
      if (!t.employee_id || (t.estado ?? "").toLowerCase() !== "terminada") continue;
      if (t.atendimento_s == null) continue;
      const cur = tma.get(t.employee_id) ?? { sum: 0, n: 0 };
      cur.sum += Number(t.atendimento_s); cur.n += 1;
      tma.set(t.employee_id, cur);
    }
    const idleStats = computeIdle(tk);

    const nps = new Map<string, { det: number; n: number }>();
    for (const s of npsQ.data ?? []) {
      if (!s.employee_id) continue;
      const nota = surveyNota(s);
      if (nota == null) continue;
      const cur = nps.get(s.employee_id) ?? { det: 0, n: 0 };
      cur.n += 1;
      if (nota <= 6) cur.det += 1;
      nps.set(s.employee_id, cur);
    }

    return emps.map((emp) => {
      const t = tma.get(emp.id);
      const i = idleStats.get(emp.id);
      const n = nps.get(emp.id);
      return {
        emp,
        pts: pts.get(emp.id) ?? 0,
        tma: t && t.n ? Math.round(t.sum / t.n) : null,
        idle: i && i.idleAvgS ? i.idleAvgS : null,
        det: n && n.n ? (n.det / n.n) * 100 : null,
        inq: n?.n ?? 0,
      };
    });
  }, [empQ.data, salesQ.data, tkQ.data, npsQ.data]);

  const loading = empQ.isLoading || salesQ.isLoading || tkQ.isLoading;

  const allBlocks = [
    {
      id: "pts" as const,
      title: "Pontos",
      icon: TrendingUp,
      color: "var(--neon-green)",
      fmt: (r: Row) => `${fmtNum(r.pts, 2)} pts`,
      pool: rows.filter((r) => r.pts > 0),
      sort: (a: Row, b: Row) => b.pts - a.pts, // desc = melhor
    },
    {
      id: "tma" as const,
      title: "TMA (atendimento)",
      icon: Timer,
      color: "var(--neon-blue)",
      fmt: (r: Row) => fmtDur(r.tma),
      pool: rows.filter((r) => r.tma != null),
      sort: (a: Row, b: Row) => (b.tma ?? 0) - (a.tma ?? 0), // maior = melhor
    },
    {
      id: "idle" as const,
      title: "Ociosidade média",
      icon: Coffee,
      color: "var(--neon-yellow)",
      fmt: (r: Row) => fmtDur(r.idle),
      pool: rows.filter((r) => r.idle != null),
      sort: (a: Row, b: Row) => (a.idle ?? 0) - (b.idle ?? 0), // menor = melhor
    },
    {
      id: "det" as const,
      title: snapQ.data ? `Detratores · ${snapQ.data.label}` : "Detratores",
      icon: HeartHandshake,
      color: "var(--neon-pink)",
      fmt: (r: Row) => `${fmtNum(r.det ?? 0, 1)}% · ${r.inq} inq.`,
      pool: rows.filter((r) => r.det != null),
      sort: (a: Row, b: Row) => (a.det ?? 0) - (b.det ?? 0), // menor = melhor
    },
  ];

  const blocks = allBlocks.filter((b) => prefs.weekBlocks.includes(b.id));

  return (
    <section className="rounded-2xl border bg-card p-3 md:p-4">
      <div className="mb-3 grid grid-cols-[minmax(0,1fr)_auto] items-center gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <CalendarRange className="h-4 w-4 shrink-0 text-[var(--neon-violet)]" />
          <h2 className="truncate text-sm font-bold">Resumo da semana</h2>
          <span className="shrink-0 text-[11px] text-muted-foreground">
            {start.slice(8)}/{start.slice(5, 7)} – {end.slice(8)}/{end.slice(5, 7)}
          </span>
        </div>
        <Popover>
          <PopoverTrigger asChild>
            <button
              type="button"
              className="inline-flex shrink-0 items-center gap-1 rounded-md border px-2 py-1 text-[11px] font-semibold hover:bg-accent"
              aria-label="Configurar resumo da semana"
            >
              <Settings2 className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">Configurar</span>
            </button>
          </PopoverTrigger>
          <PopoverContent align="end" className="w-64 space-y-3">
            <div>
              <p className="mb-1.5 text-[11px] font-bold uppercase tracking-wide text-muted-foreground">
                Métricas visíveis
              </p>
              <div className="space-y-1.5">
                {WEEK_BLOCKS.map((b) => (
                  <label key={b.id} className="flex items-center gap-2 text-xs">
                    <Checkbox
                      checked={prefs.weekBlocks.includes(b.id)}
                      onCheckedChange={() => toggleWeekBlock(b.id)}
                    />
                    <span>{b.label}</span>
                  </label>
                ))}
              </div>
            </div>
            <div>
              <p className="mb-1.5 text-[11px] font-bold uppercase tracking-wide text-muted-foreground">
                Tamanho do ranking
              </p>
              <div className="flex gap-1">
                {[3, 5, 10].map((n) => (
                  <button
                    key={n}
                    type="button"
                    onClick={() => setWeekTopN(n)}
                    className={classNames(
                      "flex-1 rounded border px-2 py-1 text-xs font-semibold",
                      prefs.weekTopN === n ? "border-[var(--neon-blue)] text-[var(--neon-blue)]" : "hover:bg-accent",
                    )}
                  >
                    Top {n}
                  </button>
                ))}
              </div>
            </div>
            <label className="flex items-center gap-2 text-xs">
              <Checkbox
                checked={prefs.weekShowBottom}
                onCheckedChange={(v) => setWeekShowBottom(!!v)}
              />
              <span>Mostrar também os últimos</span>
            </label>
            <p className="text-[10px] text-muted-foreground">
              As preferências ficam guardadas na tua conta neste dispositivo.
            </p>
          </PopoverContent>
        </Popover>
      </div>

      {blocks.length === 0 ? (
        <p className="text-[11px] text-muted-foreground">
          Sem métricas selecionadas — usa “Configurar” para escolher o que queres ver.
        </p>
      ) : (
      <div className={classNames("grid gap-3", blocks.length >= 4 ? "md:grid-cols-4" : blocks.length === 3 ? "md:grid-cols-3" : blocks.length === 2 ? "md:grid-cols-2" : "md:grid-cols-1")}>
        {blocks.map((b) => {
          const sorted = [...b.pool].sort(b.sort);
          const top = sorted.slice(0, prefs.weekTopN);
          const bottom = prefs.weekShowBottom
            ? sorted.slice(-3).reverse().filter((r) => !top.includes(r))
            : [];
          const Icon = b.icon;
          return (
            <div key={b.title} className="rounded-xl border bg-background p-2.5">
              <div className="mb-2 flex items-center gap-1.5">
                <Icon className="h-3.5 w-3.5" style={{ color: b.color }} />
                <span className="text-[11px] font-bold uppercase tracking-wide" style={{ color: b.color }}>
                  {b.title}
                </span>
              </div>
              {loading ? (
                <div className="space-y-1.5">
                  <Skeleton className="h-4 w-full" />
                  <Skeleton className="h-4 w-4/5" />
                  <Skeleton className="h-4 w-3/5" />
                </div>
              ) : sorted.length === 0 ? (
                <p className="text-[11px] text-muted-foreground">Sem dados esta semana.</p>
              ) : (
                <>
                  <ul className="space-y-1">
                    {top.map((r, i) => (
                      <PersonLine key={r.emp.id} rank={i + 1} row={r} label={b.fmt(r)} good />
                    ))}
                  </ul>
                  {bottom.length > 0 && (
                    <>
                      <div className="my-1.5 border-t border-dashed" />
                      <ul className="space-y-1">
                        {bottom.map((r) => (
                          <PersonLine key={r.emp.id} row={r} label={b.fmt(r)} good={false} />
                        ))}
                      </ul>
                    </>
                  )}
                </>
              )}
            </div>
          );
        })}
      </div>
      )}
    </section>
  );
}

function shortName(nome: string) {
  const parts = String(nome || "").trim().split(/\s+/).filter(Boolean);
  if (parts.length <= 1) return parts[0] ?? "";
  return `${parts[0]} ${parts[parts.length - 1].charAt(0)}.`;
}

function PersonLine({ row, label, good, rank }: { row: Row; label: string; good: boolean; rank?: number }) {
  return (
    <li>
      <Link
        to="/individual/$slug"
        params={{ slug: row.emp.slug }}
        className="flex items-center gap-1.5 rounded px-1 py-0.5 text-[11px] hover:bg-accent"
      >
        <span className={classNames("w-4 shrink-0 text-center font-bold", good ? "text-[var(--neon-green)]" : "text-muted-foreground")}>
          {rank ? `${rank}º` : "·"}
        </span>
        <span className="flex-1 truncate font-medium" title={row.emp.nome}>{shortName(row.emp.nome)}</span>
        <span className="shrink-0 tabular-nums text-muted-foreground">{label}</span>
      </Link>
    </li>
  );
}
