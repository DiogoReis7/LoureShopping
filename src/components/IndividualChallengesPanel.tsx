import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";
import { Trophy, Target, X, CalendarDays, Sparkles } from "lucide-react";
import { computeProgress, METRIC_LABELS, REDUCTION_METRICS, type Metric } from "@/lib/challenges";
import { fmtNum, ymd } from "@/lib/domain";
import { useAuth } from "@/hooks/use-auth";
import { readNotifPrefs } from "@/lib/notif-prefs";

type Challenge = {
  id: string;
  titulo: string;
  descricao: string | null;
  tipo: "diario" | "semanal" | "mensal";
  start_date: string;
  end_date: string;
  scope: "loja" | "individual";
  metric: Metric;
  target: number;
  premio: string | null;
  ativo: boolean;
};

type ChallengeProgress = {
  ch: Challenge;
  empValue: number;
  totalValue: number;
  rank: number | null;
  participants: number;
  target: number;
  done: boolean;
  pct: number;
};

function useActiveChallenges(employeeId: string | undefined) {
  const today = ymd(new Date());
  const chQ = useQuery({
    queryKey: ["challenges-active", today],
    queryFn: async () => {
      const { data } = await supabase
        .from("challenges")
        .select("*")
        .eq("ativo", true)
        .lte("start_date", today)
        .gte("end_date", today)
        .order("start_date", { ascending: false });
      return (data ?? []) as Challenge[];
    },
  });
  const prodQ = useQuery({
    queryKey: ["products-min"],
    queryFn: async () => (await supabase.from("products").select("id,codigo,peso")).data ?? [],
  });

  const active = chQ.data ?? [];
  const ranges = useMemo(() => {
    const seen = new Set<string>();
    return active
      .filter((c) => c.metric !== "nps_det")
      .filter((c) => { const k = `${c.start_date}|${c.end_date}`; if (seen.has(k)) return false; seen.add(k); return true; })
      .map((c) => ({ start: c.start_date, end: c.end_date }));
  }, [active]);

  const salesQ = useQuery({
    queryKey: ["challenges-sales", ranges],
    enabled: ranges.length > 0,
    queryFn: async () => {
      const out: Record<string, { employee_id: string; product_id: string; quantidade: number }[]> = {};
      for (const r of ranges) {
        const { data } = await supabase
          .from("sales_entries")
          .select("employee_id,product_id,quantidade")
          .gte("data", r.start)
          .lte("data", r.end);
        out[`${r.start}|${r.end}`] = data ?? [];
      }
      return out;
    },
  });

  const npsQ = useQuery({
    queryKey: ["challenges-nps-latest"],
    enabled: active.some((c) => c.metric === "nps_det"),
    queryFn: async () => {
      const { data: snap } = await supabase
        .from("nps_snapshots").select("id").order("created_at", { ascending: false }).limit(1).maybeSingle();
      if (!snap) return [] as { employee_id: string | null; det_pct: number | null; inqueritos: number | null }[];
      const { data } = await supabase
        .from("nps_scores")
        .select("employee_id,det_pct,inqueritos")
        .eq("snapshot_id", snap.id);
      return data ?? [];
    },
  });

  const progresses = useMemo<ChallengeProgress[]>(() => {
    if (!employeeId) return [];
    return active.map((ch) => {
      if (ch.metric === "nps_det") {
        const rows = (npsQ.data ?? []);
        const mine = rows.find((r) => r.employee_id === employeeId);
        const target = Number(ch.target);
        const empValue = mine ? Number(mine.det_pct ?? 0) * 100 : 0;
        // ranking = ordenar por det_pct asc (menor = melhor); apenas com inquéritos
        const ranked = rows
          .filter((r) => r.employee_id && Number(r.inqueritos ?? 0) > 0)
          .map((r) => ({ id: r.employee_id!, v: Number(r.det_pct ?? 0) * 100 }))
          .sort((a, b) => a.v - b.v);
        const rank = ranked.findIndex((r) => r.id === employeeId);
        const totalInq = rows.reduce((a, r) => a + Number(r.inqueritos ?? 0), 0);
        const weightedDet = rows.reduce((a, r) => a + Number(r.det_pct ?? 0) * Number(r.inqueritos ?? 0), 0);
        const lojaPct = totalInq > 0 ? (weightedDet / totalInq) * 100 : 0;
        const totalValue = lojaPct;
        const done = mine ? empValue <= target : totalValue <= target;
        // pct visual: 100 quando abaixo do alvo
        const pct = target > 0 ? Math.max(0, Math.min(100, (1 - (empValue - target) / Math.max(target, 1)) * 100)) : 0;
        return { ch, empValue, totalValue, rank: rank >= 0 ? rank + 1 : null, participants: ranked.length, target, done, pct };
      }
      const sales = salesQ.data?.[`${ch.start_date}|${ch.end_date}`] ?? [];
      const prods = (prodQ.data ?? []) as { id: string; codigo: string; peso: number }[];
      const prog = computeProgress(sales, prods, ch.metric);
      const empValue = prog.byEmp.get(employeeId) ?? 0;
      const ranked = [...prog.byEmp.entries()].sort((a, b) => b[1] - a[1]);
      const rank = ranked.findIndex(([id]) => id === employeeId);
      const target = Number(ch.target);
      const isReduction = REDUCTION_METRICS.has(ch.metric);
      const reference = ch.scope === "loja" ? prog.total : empValue;
      const done = isReduction ? reference <= target : reference >= target;
      const pct = target > 0 ? Math.min(100, (reference / target) * 100) : 0;
      return { ch, empValue, totalValue: prog.total, rank: rank >= 0 ? rank + 1 : null, participants: ranked.length, target, done, pct };
    });
  }, [active, employeeId, salesQ.data, prodQ.data, npsQ.data]);

  return { progresses, isLoading: chQ.isLoading };
}

function computeDigest(ids: string[]): string {
  return [...ids].sort().join(",");
}

export function IndividualChallengesPanel({ employeeId }: { employeeId: string | undefined }) {
  const { progresses } = useActiveChallenges(employeeId);
  const { user } = useAuth();
  const [popupOpen, setPopupOpen] = useState(false);
  const seenDate = ymd(new Date());
  const digest = useMemo(() => computeDigest(progresses.map((p) => p.ch.id)), [progresses]);

  // Persistência do "já visto" na base de dados — 1x por colaborador/dia/conjunto de desafios.
  const seenQ = useQuery({
    queryKey: ["challenge-popup-seen", employeeId, seenDate, digest],
    enabled: !!employeeId && progresses.length > 0,
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const { data } = await supabase
        .from("challenge_popup_seen")
        .select("digest")
        .eq("employee_id", employeeId!)
        .eq("seen_date", seenDate)
        .eq("digest", digest)
        .maybeSingle();
      return !!data;
    },
  });

  useEffect(() => {
    if (!employeeId || progresses.length === 0) return;
    if (seenQ.isLoading || seenQ.data === undefined) return;
    if (seenQ.data) return;
    if (!readNotifPrefs(user?.id ?? null).desafios) return;
    setPopupOpen(true);
    void supabase
      .from("challenge_popup_seen")
      .insert({ employee_id: employeeId, seen_date: seenDate, digest })
      .then(() => { /* fire-and-forget */ });
  }, [employeeId, progresses.length, seenQ.data, seenQ.isLoading, digest, seenDate, user?.id]);

  if (!employeeId || progresses.length === 0) return null;


  return (
    <>
      <section className="mb-2 overflow-hidden rounded-lg border bg-card shadow-sm">
        <header
          className="flex items-center justify-between gap-2 px-2.5 py-1 text-white"
          style={{ background: "linear-gradient(90deg, var(--neon-yellow), color-mix(in oklab, var(--neon-yellow) 55%, black))" }}
        >
          <h2 className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-widest text-black/85">
            <Trophy className="h-3 w-3" /> Desafios ativos ({progresses.length})
          </h2>
          <button
            onClick={() => setPopupOpen(true)}
            className="rounded bg-black/20 px-1.5 py-0.5 text-[10px] font-bold uppercase text-white hover:bg-black/30"
          >
            Ver tudo
          </button>
        </header>
        <div className="grid grid-cols-1 gap-px bg-border sm:grid-cols-2">
          {progresses.map((p) => (
            <ChallengeRow key={p.ch.id} p={p} />
          ))}
        </div>
      </section>

      {popupOpen && <ChallengePopup progresses={progresses} onClose={() => setPopupOpen(false)} />}
    </>
  );
}

function formatValue(p: ChallengeProgress) {
  if (p.ch.metric === "nps_det") return `${p.empValue.toFixed(1)}% ≤ ${p.target}%`;
  return `${fmtNum(p.empValue, 2)} / ${fmtNum(p.target, 2)}`;
}

function ChallengeRow({ p }: { p: ChallengeProgress }) {
  const color = p.done ? "var(--neon-green)" : p.ch.metric === "nps_det" ? "var(--neon-pink)" : "var(--neon-blue)";
  return (
    <div className="bg-card p-2">
      <div className="flex items-center justify-between gap-2">
        <div className="min-w-0">
          <div className="flex items-center gap-1.5">
            <span className="truncate text-xs font-bold" style={{ color: "var(--neon-yellow)" }}>{p.ch.titulo}</span>
            {p.rank && <span className="rounded-full bg-muted px-1.5 py-0.5 text-[9px] font-bold tabular-nums">#{p.rank}/{p.participants}</span>}
          </div>
          <div className="text-[10px] text-muted-foreground">{METRIC_LABELS[p.ch.metric]}</div>
        </div>
        <div className="text-right">
          <div className="text-[11px] font-bold tabular-nums" style={{ color }}>{formatValue(p)}</div>
          {p.ch.premio && <div className="text-[9px] text-[var(--neon-pink)]">🎁 {p.ch.premio}</div>}
        </div>
      </div>
      <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-muted">
        <div
          className="h-full transition-all"
          style={{ width: `${p.pct}%`, background: color, boxShadow: `0 0 8px ${color}` }}
        />
      </div>
    </div>
  );
}

function ChallengePopup({ progresses, onClose }: { progresses: ChallengeProgress[]; onClose: () => void }) {
  return (
    <div
      className="fixed inset-0 z-[200] grid place-items-center bg-black/60 p-4"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        className="w-full max-w-lg overflow-hidden rounded-2xl border bg-card shadow-2xl"
        style={{ boxShadow: "0 0 40px color-mix(in oklab, var(--neon-yellow) 45%, transparent)" }}
        onClick={(e) => e.stopPropagation()}
      >
        <header
          className="flex items-center justify-between px-4 py-3 text-black"
          style={{ background: "linear-gradient(90deg, var(--neon-yellow), var(--neon-orange, var(--neon-pink)))" }}
        >
          <div className="flex items-center gap-2">
            <Sparkles className="h-5 w-5" />
            <h2 className="text-sm font-black uppercase tracking-widest">Desafios a decorrer</h2>
          </div>
          <button onClick={onClose} className="rounded-full p-1 hover:bg-black/15" aria-label="Fechar">
            <X className="h-4 w-4" />
          </button>
        </header>
        <div className="max-h-[70vh] overflow-y-auto p-3 space-y-2">
          {progresses.map((p) => (
            <PopupCard key={p.ch.id} p={p} />
          ))}
          <div className="pt-2 text-center">
            <Link
              to="/desafios"
              className="inline-flex items-center gap-1 rounded-md border bg-background px-3 py-1.5 text-xs font-semibold hover:bg-accent"
            >
              Ver todos os desafios
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}

function PopupCard({ p }: { p: ChallengeProgress }) {
  const color = p.done ? "var(--neon-green)" : p.ch.metric === "nps_det" ? "var(--neon-pink)" : "var(--neon-blue)";
  const rankLabel =
    p.rank == null ? "Ainda sem posição" :
    p.rank === 1 ? "🥇 1º lugar" :
    p.rank === 2 ? "🥈 2º lugar" :
    p.rank === 3 ? "🥉 3º lugar" :
    `${p.rank}º de ${p.participants}`;

  return (
    <div className="rounded-xl border p-3" style={{ borderColor: `color-mix(in oklab, ${color} 40%, transparent)` }}>
      <div className="flex items-start justify-between gap-2">
        <div>
          <h3 className="text-sm font-black" style={{ color: "var(--neon-yellow)" }}>{p.ch.titulo}</h3>
          {p.ch.descricao && <p className="mt-0.5 text-[11px] text-muted-foreground">{p.ch.descricao}</p>}
          <div className="mt-1 flex flex-wrap items-center gap-2 text-[10px] text-muted-foreground">
            <span className="inline-flex items-center gap-1"><CalendarDays className="h-3 w-3" /> {p.ch.start_date}{p.ch.start_date !== p.ch.end_date ? ` → ${p.ch.end_date}` : ""}</span>
            <span className="inline-flex items-center gap-1"><Target className="h-3 w-3" /> {METRIC_LABELS[p.ch.metric]}</span>
            <span className={p.ch.scope === "loja" ? "rounded bg-muted px-1.5 py-0.5" : "rounded bg-muted px-1.5 py-0.5"}>
              {p.ch.scope === "loja" ? "Loja" : "Individual"}
            </span>
          </div>
        </div>
        {p.ch.premio && (
          <span className="shrink-0 rounded-full bg-[var(--neon-pink)]/15 px-2 py-0.5 text-[10px] font-bold text-[var(--neon-pink)]">
            🎁 {p.ch.premio}
          </span>
        )}
      </div>

      <div className="mt-2 grid grid-cols-2 gap-2 text-center">
        <div className="rounded-lg border bg-background p-2">
          <div className="text-[9px] uppercase tracking-wider text-muted-foreground">O teu valor</div>
          <div className="mt-0.5 text-lg font-black tabular-nums" style={{ color }}>{formatValue(p)}</div>
        </div>
        <div className="rounded-lg border bg-background p-2">
          <div className="text-[9px] uppercase tracking-wider text-muted-foreground">Posição</div>
          <div className="mt-0.5 text-lg font-black">{rankLabel}</div>
        </div>
      </div>

      <div className="mt-2 h-2 overflow-hidden rounded-full bg-muted">
        <div
          className="h-full transition-all"
          style={{ width: `${p.pct}%`, background: color, boxShadow: `0 0 10px ${color}` }}
        />
      </div>
      {p.done ? (
        <p className="mt-1 text-[11px] font-semibold" style={{ color: "var(--neon-green)" }}>Objetivo atingido! Continua assim 🚀</p>
      ) : (
        <p className="mt-1 text-[11px] text-muted-foreground">
          {p.ch.metric === "nps_det"
            ? `Manter a % de detratores abaixo de ${p.target}%.`
            : `Faltam ${fmtNum(Math.max(0, p.target - p.empValue), 2)} para completar.`}
        </p>
      )}
    </div>
  );
}
