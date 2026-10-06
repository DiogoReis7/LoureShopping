import { createFileRoute, notFound, Link } from "@tanstack/react-router";
import { RouteError, RouteNotFound, pageHead } from "@/components/RouteBoundary";
import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/AppShell";
import { MonthDayPicker } from "@/components/MonthDayPicker";
import { useSharedDate } from "@/hooks/useSharedDate";
import { MONTHS_PT, fmtNum, fmtSecsAsTime, ymd, classNames } from "@/lib/domain";
import {
  ArrowLeft, Minus, Plus, TrendingUp, Package, Ticket, Timer, Clock, Trophy, Lock, Search,
} from "lucide-react";
import { toast } from "sonner";
import { useIsAdmin } from "@/hooks/use-is-admin";
import { NeonIcon, pickIcon, pickIconByCode } from "@/lib/product-icons";
import { useNpsAlert, NPS_DET_THRESHOLD } from "@/hooks/use-nps-alert";
import { AlertTriangle } from "lucide-react";
import { IndividualNpsPanel } from "@/components/IndividualNpsPanel";
import { isMedicalLeave, isMeeting, isSalesBlockedShift } from "@/lib/shift-state";

export const Route = createFileRoute("/_authenticated/individual/$slug")({
  head: pageHead("Desempenho individual · PDS LoureShopping", "Vendas, pontos, senhas e NPS de cada colaborador."),
  errorComponent: ({ error, reset }) => <RouteError error={error} reset={reset} />,
  notFoundComponent: () => <RouteNotFound />,
  component: IndividualPage,
});

type Product = {
  id: string; codigo: string; nome: string;
  categoria: string | null; peso: number; ativo: boolean; ordem: number;
};
type Sale = { employee_id: string; product_id: string; data: string; quantidade: number };

function normalize(s: string | null | undefined) {
  return (s ?? "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

// Buckets iguais ao PDS / Quadro IOS
const FIXO_CODES = new Set(["tv", "net", "voz", "wifi-total", "migracoes", "migracoes-tv"]);
const MOVEL_CODES = new Set(["cv", "cv-por-retencao", "pp", "pre-pagos"]);
const MARCACOES_CODES = new Set(["sm-1a", "sm-2a", "sm-1a-estrela", "sm-2a-estrela", "sm-1a-movel", "sm-2a-movel", "xpert", "ecn", "premium", "segue-retencao"]);
const RETOMA_CODES = new Set(["cv-retoma", "retoma"]);
const NEGOCIO_CODES = new Set(["alarmes", "alarme", "smp", "smp-retoma", "acess", "pelicula", "seguro", "seg-fat", "device", "hotspot", "energia", "energia-sa", "cv-retoma", "retoma"]);

function bucketOf(codigo: string): { key: string; label: string; color: string; order: number } {
  const c = codigo.toLowerCase();
  if (c === "nc") return { key: "nc", label: "NC — Novos Contratos", color: "var(--neon-green)", order: 0 };
  if (FIXO_CODES.has(c)) return { key: "fixo", label: "FIXO", color: "var(--neon-yellow)", order: 1 };
  if (MOVEL_CODES.has(c)) return { key: "movel", label: "MÓVEL", color: "var(--neon-blue)", order: 2 };
  if (MARCACOES_CODES.has(c)) return { key: "marcacoes", label: "MARCAÇÕES", color: "var(--neon-violet)", order: 3 };
  if (NEGOCIO_CODES.has(c)) return { key: "negocio", label: "+NEGÓCIO", color: "var(--neon-orange)", order: 4 };
  if (c === "combina") return { key: "combina", label: "COMBINA · Continente", color: "var(--neon-pink)", order: 5 };
  return { key: "outros", label: "Outros", color: "var(--neon-blue)", order: 9 };
}

function IndividualPage() {
  const { slug } = Route.useParams();
  const qc = useQueryClient();
  const isAdmin = useIsAdmin();
  const [{ year, month, day }, setDate] = useSharedDate();
  const dayIso = ymd(new Date(year, month - 1, day));

  const empQ = useQuery({
    queryKey: ["employee", slug],
    queryFn: async () => {
      const { data, error } = await supabase.from("employees")
        .select("id,nome,slug,username_sgf,nome_sgf,ativo,ordem,categoria")
        .eq("slug", slug).maybeSingle();
      if (error) throw error;
      if (!data) throw notFound();
      return data as any;
    },
  });

  const prodQ = useQuery({
    queryKey: ["products"],
    queryFn: async () => {
      const { data } = await supabase.from("products").select("id,codigo,nome,categoria,peso,ativo,ordem").eq("ativo", true).order("ordem");
      return (data ?? []) as Product[];
    },
  });

  const shiftQ = useQuery({
    queryKey: ["shift-day", dayIso],
    queryFn: async () => {
      const { data } = await supabase.from("shift_days")
        .select("employee_id,horas,estado,descricao").eq("data", dayIso);
      return (data ?? []) as { employee_id: string; horas: number | null; estado: string | null; descricao: string | null }[];
    },
  });

  const sgfQ = useQuery({
    queryKey: ["sgf-tickets-emp", slug, dayIso],
    queryFn: async () => {
      if (!empQ.data?.username_sgf) return [];
      const { data } = await supabase.from("sgf_tickets")
        .select("senha,estado,espera_s,atendimento_s,emitida_em,employee_id,inicio_em,fim_em")
        .eq("employee_id", empQ.data.id)
        .gte("emitida_em", dayIso + "T00:00:00")
        .lte("emitida_em", dayIso + "T23:59:59");
      return (data ?? []) as any[];
    },
  });

  const salesQ = useQuery({
    queryKey: ["sales-emp-day", slug, dayIso],
    queryFn: async () => {
      if (!empQ.data) return [];
      const { data } = await supabase.from("sales_entries")
        .select("employee_id,product_id,data,quantidade")
        .eq("employee_id", empQ.data.id)
        .eq("data", dayIso);
      return (data ?? []) as Sale[];
    },
  });

  const prodMap = useMemo(() => new Map(prodQ.data?.map((p) => [p.id, p]) ?? []), [prodQ.data]);
  const products = prodQ.data ?? [];
  const sales = salesQ.data ?? [];
  const emp = empQ.data;
  const shift = shiftQ.data?.find((s) => s.employee_id === emp?.id);
  const tickets = sgfQ.data ?? [];

  const workingToday = shift && !isSalesBlockedShift(shift) && (shift.estado === "trabalha" || Number(shift.horas ?? 0) > 0);
  const isOffShift = !workingToday;

  const [draft, setDraft] = useState<Record<string, number>>({});

  const quantities = useMemo(() => {
    const q: Record<string, number> = {};
    for (const s of sales) {
      const p = prodMap.get(s.product_id);
      if (!p) continue;
      q[p.id] = (q[p.id] ?? 0) + s.quantidade;
    }
    return q;
  }, [sales, prodMap]);

  const qty = (id: string) => draft[id] ?? quantities[id] ?? 0;

  const totals = useMemo(() => {
    const m: Record<string, number> = {};
    for (const p of products) {
      const q = qty(p.id);
      if (q === 0) continue;
      const w = q * (p.peso ?? 0);
      const code = p.codigo?.toLowerCase() ?? "";
      const isRetoma = RETOMA_CODES.has(code);
      if (code === "nc") m["NC"] = (m["NC"] ?? 0) + q;
      else if (code === "alarmes" || code === "alarme") m["Alarme"] = (m["Alarme"] ?? 0) + q;
      else if (MOVEL_CODES.has(code)) m["Móvel"] = (m["Móvel"] ?? 0) + w;
      else if (MARCACOES_CODES.has(code)) m["Marcações"] = (m["Marcações"] ?? 0) + w;
      else if (code === "energia" || code === "energia-sa") m["Energia"] = (m["Energia"] ?? 0) + q;
      else if (FIXO_CODES.has(code)) m["Fixo"] = (m["Fixo"] ?? 0) + w;
      if (isRetoma) m["MaisNegocio"] = (m["MaisNegocio"] ?? 0) + w;
      if (!["combina", "nc"].includes(code) && !FIXO_CODES.has(code) && !MOVEL_CODES.has(code) && !MARCACOES_CODES.has(code) && !isRetoma) {
        m["MaisNegocio"] = (m["MaisNegocio"] ?? 0) + w;
      }
    }
    return m;
  }, [products, qty]);

  const totalPts = useMemo(() => {
    let pts = 0;
    for (const p of products) {
      const q = qty(p.id);
      if (q === 0) continue;
      const code = p.codigo?.toLowerCase() ?? "";
      if (["combina", "nc"].includes(code)) continue;
      if (code === "migracoes-tv") continue;
      pts += q * (p.peso ?? 0);
    }
    return pts;
  }, [products, qty]);

  const atendidos = useMemo(() => tickets.filter((t) => t.estado === "terminada").length, [tickets]);
  const tma = useMemo(() => {
    const aRows = tickets.filter((t) => t.atendimento_s);
    return aRows.length > 0 ? aRows.reduce((a, r) => a + (r.atendimento_s ?? 0), 0) / aRows.length : 0;
  }, [tickets]);

  const nps = useNpsAlert(emp?.id);

  async function commit(delta: number, product: Product) {
    const newQty = Math.max(0, qty(product.id) + delta);
    const current = quantities[product.id] ?? 0;
    if (newQty === current) {
      setDraft((d) => {
        const x = { ...d };
        delete x[product.id];
        return x;
      });
    } else {
      setDraft((d) => ({ ...d, [product.id]: newQty }));
    }
    if (newQty === current) return;
    const { error } = await supabase.from("sales_entries").upsert(
      { employee_id: emp!.id, product_id: product.id, data: dayIso, quantidade: newQty },
      { onConflict: "employee_id,product_id,data" },
    );
    if (error) {
      toast.error("Erro ao guardar venda");
      setDraft((d) => {
        const x = { ...d };
        delete x[product.id];
        return x;
      });
      return;
    }
    qc.invalidateQueries({ queryKey: ["sales-emp-day", slug] });
    toast.success(`${product.nome} · ${newQty} un`);
  }

  if (!emp) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-center">
          <Trophy className="mx-auto mb-4 h-12 w-12 text-muted-foreground" />
          <p className="text-muted-foreground">A carregar dados do colaborador…</p>
        </div>
      </div>
    );
  }

  return (
    <div>
      <PageHeader
        title={emp.nome}
        subtitle={MONTHS_PT[month - 1] + " " + year}
        actions={
          <div className="flex items-center gap-2">
            <Link
              to="/pds"
              className="inline-flex items-center gap-1.5 rounded-md border bg-card px-2.5 py-1.5 text-xs font-semibold hover:bg-accent"
            >
              <ArrowLeft className="h-3.5 w-3.5" />
              Voltar PDS
            </Link>
            <MonthDayPicker year={year} month={month} day={day} onChange={setDate} />
          </div>
        }
      />

      <IndividualNpsPanel employee={emp} date={dayIso} />

      {nps && nps.detractors > 0 && nps.detractorsPct >= NPS_DET_THRESHOLD && (
        <div className="mx-3 mt-3 flex items-start gap-3 rounded-md border border-destructive/40 bg-destructive/5 p-3">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
          <div className="flex-1">
            <div className="font-semibold text-foreground">⚠ Atenção: NPS crítico</div>
            <div className="text-xs text-muted-foreground mt-1">
              {nps.detractorsPct.toFixed(1)}% Detratores ({nps.detractors} de {nps.total} interações)
            </div>
          </div>
        </div>
      )}

      <div className="p-3 space-y-3">
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
          <StatCard label="Pontos" value={fmtNum(totalPts, 2)} color="var(--neon-blue)" />
          <StatCard label="Atd." value={fmtNum(atendidos, 0)} color="var(--neon-green)" />
          <StatCard label="TMA" value={fmtSecsAsTime(tma)} color="var(--neon-violet)" />
          <StatCard label="Efic." value={emp?.objetivo_mes ? fmtNum((totalPts / Number(emp.objetivo_mes)) * 100, 0) + "%" : "—"} color="var(--neon-yellow)" />
          <StatCard label="Shift" value={isOffShift ? "Folga" : shift?.estado?.toUpperCase() ?? "—"} color={isOffShift ? "var(--destructive)" : "var(--success)"} />
        </div>

        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {(["Fixo", "Móvel", "Marcações", "MaisNegocio"] as const).map((k) => (
            <div key={k} className="rounded-md border bg-card px-3 py-2">
              <div className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground">{k === "MaisNegocio" ? "+Negócio" : k}</div>
              <div className="text-base font-extrabold tabular-nums">{fmtNum(totals[k] ?? 0, 2)}</div>
            </div>
          ))}
        </div>

        <div className="rounded-lg border bg-card">
          <div className="sticky top-0 z-10 border-b bg-card px-3 py-2">
            <div className="flex items-center justify-between gap-2">
              <div className="text-xs font-bold uppercase text-muted-foreground">Vendas do dia</div>
              <div className="text-[10px] text-muted-foreground">
                {products.filter((p) => qty(p.id) > 0).length} produtos
              </div>
            </div>
          </div>
          <div className="max-h-[60vh] overflow-y-auto">
            {products.length === 0 ? (
              <div className="py-8 text-center text-xs text-muted-foreground">Sem produtos</div>
            ) : (
              products.map((p) => (
                <div key={p.id} className="flex items-center justify-between gap-2 border-b px-3 py-2 last:border-0 hover:bg-muted/30">
                  <div className="flex-1 min-w-0">
                    <div className="text-xs font-semibold truncate text-foreground">{p.nome}</div>
                    <div className="text-[10px] text-muted-foreground">{p.codigo}</div>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <button
                      onClick={() => commit(-1, p)}
                      onContextMenu={(e) => { e.preventDefault(); commit(-1, p); }}
                      className="press grid h-7 w-7 place-items-center rounded border bg-card text-xs font-bold"
                      title="Clique para -1 · Clique direito para -1"
                    >
                      <Minus className="h-3 w-3" />
                    </button>
                    <div className="w-8 text-center text-xs font-bold tabular-nums">{qty(p.id)}</div>
                    <button
                      onClick={() => commit(+1, p)}
                      onContextMenu={(e) => { e.preventDefault(); commit(-1, p); }}
                      className="press grid h-7 w-7 place-items-center rounded border bg-card text-xs font-bold"
                      title="Clique para +1 · Clique direito para -1"
                    >
                      <Plus className="h-3 w-3" />
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function StatCard({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <div className="rounded-md border bg-card px-2.5 py-2" style={{ borderLeft: `3px solid ${color}` }}>
      <div className="text-[9px] font-bold uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className="text-sm font-extrabold tabular-nums" style={{ color }}>{value}</div>
    </div>
  );
}
