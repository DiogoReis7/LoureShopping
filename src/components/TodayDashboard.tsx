import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";
import { ymd, fmtNum } from "@/lib/domain";
import { AnimatedNumber } from "@/components/AnimatedNumber";
import { EXCLUDED, INDICATOR_ONLY_CODES } from "@/lib/challenges";
import { useNpsAlert, NPS_DET_THRESHOLD } from "@/hooks/use-nps-alert";
import { Skeleton } from "@/components/ui/skeleton";
import { Zap, ShoppingBag, Ticket, AlertTriangle } from "lucide-react";

type Tone = "blue" | "green" | "violet" | "pink";
const TONE: Record<Tone, string> = {
  blue: "var(--neon-blue)",
  green: "var(--neon-green)",
  violet: "var(--neon-violet)",
  pink: "var(--neon-pink)",
};

function KpiCard({
  label, value, formatter, hint, icon: Icon, tone, to, loading,
}: {
  label: string; value: number; formatter?: (value: number) => string; hint?: string;
  icon: typeof Zap; tone: Tone; to: string; loading?: boolean;
}) {
  const color = TONE[tone];
  return (
    <Link
      to={to}
      className="group relative overflow-hidden rounded-2xl glass-card lift press p-3 focus-neon"
      style={{ boxShadow: `inset 0 0 0 1px color-mix(in oklab, ${color} 26%, transparent)` }}
    >
      <div
        className="absolute -right-5 -top-5 h-16 w-16 rounded-full opacity-25 blur-2xl transition-opacity group-hover:opacity-50"
        style={{ background: color }}
      />
      <div className="relative flex items-center gap-2">
        <span
          className="grid h-8 w-8 shrink-0 place-items-center rounded-lg"
          style={{ background: `color-mix(in oklab, ${color} 18%, transparent)`, color }}
        >
          <Icon className="h-4 w-4" />
        </span>
        <span className="text-[11px] font-semibold uppercase tracking-wide text-foreground/70">{label}</span>
      </div>
      <div className="relative mt-2">
        {loading ? (
          <Skeleton className="h-7 w-20" />
        ) : (
          <div className="kpi-neon text-2xl" style={{ color }}>
            <AnimatedNumber value={value} formatter={formatter} />
          </div>
        )}
        <div className="mt-0.5 h-4 text-[11px] text-muted-foreground truncate">
          {loading ? <Skeleton className="h-3 w-24" /> : hint}
        </div>
      </div>
    </Link>
  );
}

export function TodayDashboard() {
  const today = ymd(new Date());

  const salesQ = useQuery({
    queryKey: ["home-today-sales", today],
    queryFn: async () => {
      const [{ data: sales }, { data: prods }] = await Promise.all([
        supabase.from("sales_entries").select("product_id,quantidade").eq("data", today),
        supabase.from("products").select("id,codigo,peso"),
      ]);
      const pmap = new Map((prods ?? []).map((p: any) => [p.id, p]));
      let pts = 0;
      let qty = 0;
      for (const s of sales ?? []) {
        const p: any = pmap.get((s as any).product_id);
        if (!p) continue;
        if (INDICATOR_ONLY_CODES.has(p.codigo)) continue;
        const q = Number((s as any).quantidade) || 0;
        qty += q;
        if (!EXCLUDED.has(p.codigo)) pts += q * (Number(p.peso) || 0);
      }
      return { pts, qty };
    },
    staleTime: 30_000,
  });

  const ticketsQ = useQuery({
    queryKey: ["home-today-tickets", today],
    queryFn: async () => {
      const { data } = await supabase
        .from("sgf_tickets")
        .select("estado")
        .gte("emitida_em", today + "T00:00:00")
        .lte("emitida_em", today + "T23:59:59");
      const rows = data ?? [];
      return {
        total: rows.length,
        atendidos: rows.filter((r: any) => r.estado === "terminada").length,
        cancelados: rows.filter((r: any) => r.estado === "cancelado").length,
      };
    },
    staleTime: 30_000,
  });

  const npsQ = useNpsAlert();
  const alertCount = npsQ.data?.rows?.length ?? 0;

  const dateLabel = useMemo(
    () => new Date().toLocaleDateString("pt-PT", { weekday: "long", day: "2-digit", month: "long" }),
    [],
  );

  return (
    <section className="space-y-2">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-bold">Hoje</h2>
        <span className="text-[11px] capitalize text-muted-foreground">{dateLabel}</span>
      </div>
      <div className="grid grid-cols-2 gap-2 md:grid-cols-4 md:gap-3 stagger">
        <KpiCard
          label="Pontos" tone="blue" icon={Zap} to="/pds" loading={salesQ.isLoading}
          value={salesQ.data?.pts ?? 0} formatter={(value) => fmtNum(value, 2)} hint="Total da loja hoje"
        />
        <KpiCard
          label="Vendas" tone="green" icon={ShoppingBag} to="/pds" loading={salesQ.isLoading}
          value={salesQ.data?.qty ?? 0} formatter={(value) => fmtNum(value, 0)} hint="Unidades registadas"
        />
        <KpiCard
          label="Senhas" tone="violet" icon={Ticket} to="/contador" loading={ticketsQ.isLoading}
          value={ticketsQ.data?.atendidos ?? 0} formatter={(value) => fmtNum(value, 0)}
          hint={`${ticketsQ.data?.total ?? 0} entradas · ${ticketsQ.data?.cancelados ?? 0} canc.`}
        />
        <KpiCard
          label="Alertas NPS" tone="pink" icon={AlertTriangle} to="/nps" loading={npsQ.isLoading}
          value={alertCount} formatter={(value) => fmtNum(value, 0)}
          hint={alertCount ? `Acima de ${Math.round(NPS_DET_THRESHOLD * 100)}% detratores` : "Sem alertas"}
        />
      </div>
    </section>
  );
}
