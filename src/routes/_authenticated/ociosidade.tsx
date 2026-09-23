import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  Coffee, Settings2, RotateCcw, Download, Phone, Check, Calendar,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { withoutManagers } from "@/lib/manager";
import { PageHeader } from "@/components/AppShell";
import { RouteError, RouteNotFound } from "@/components/RouteBoundary";
import { MonthDayPicker } from "@/components/MonthDayPicker";
import { useSharedDate } from "@/hooks/useSharedDate";
import { useIdleConfig } from "@/hooks/use-idle-config";
import {
  computeIdleDaily, fmtDur, parseLunch, TELE_HOURS, TELE_WINDOWS, slotIsAvailable, isWorkingState,
  type IdleDayRow, type IdleTicket, type LunchWindow,
} from "@/lib/idle";
import { classNames, monthRange, MONTHS_PT } from "@/lib/domain";
import { exportCsv } from "@/lib/export-csv";

export const Route = createFileRoute("/_authenticated/ociosidade")({
  errorComponent: ({ error, reset }) => <RouteError error={error} reset={reset} />,
  notFoundComponent: () => <RouteNotFound />,
  head: () => ({
    meta: [
      { title: "Ociosidade e Telemarketing — Loures Shopping" },
      { name: "description", content: "Tempo morto entre atendimentos por dia e período, com registo horário de telemarketing e vendas." },
      { property: "og:title", content: "Ociosidade e Telemarketing" },
      { property: "og:description", content: "Análise de ociosidade por período e registo de telemarketing hora a hora." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: OciosidadePage,
});

type Employee = { id: string; nome: string; ativo: boolean; ordem: number };
type Shift = { employee_id: string; data: string; descricao: string | null; estado: string | null };
type Shift2 = Shift & { horas: number | null };
type Slot = { id: string; employee_id: string; data: string; hora: number; feito: boolean; vendas: number };

async function fetchAll<T>(build: () => any): Promise<T[]> {
  const PAGE = 1000;
  const out: T[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await build().range(from, from + PAGE - 1);
    if (error) throw error;
    const rows = (data ?? []) as T[];
    out.push(...rows);
    if (rows.length < PAGE) break;
  }
  return out;
}

const pct = (n: number) => `${n.toFixed(1)}%`;

function OciosidadePage() {
  const qc = useQueryClient();
  const [date, setDate] = useSharedDate();
  const { config, update, reset } = useIdleConfig();
  const [showCfg, setShowCfg] = useState(false);
  const [tab, setTab] = useState<"ociosidade" | "telemarketing">("ociosidade");
  const [empFilter, setEmpFilter] = useState<string>("");

  const { year, month, day } = date;
  const { start, end } = useMemo(() => monthRange(year, month), [year, month]);
  const iso = `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;

  const empQ = useQuery({
    queryKey: ["employees", "ociosidade"],
    queryFn: async () => {
      const { data, error } = await supabase.from("employees").select("id,nome,username_sgf,ativo,ordem").order("ordem");
      if (error) throw error;
      return withoutManagers((data ?? []) as any) as Employee[];
    },
  });
  const employees = useMemo(() => (empQ.data ?? []).filter((e) => e.ativo), [empQ.data]);
  const empMap = useMemo(() => new Map(employees.map((e) => [e.id, e])), [employees]);

  const ticketsQ = useQuery({
    queryKey: ["desempenho-idle", "ociosidade", start, end],
    queryFn: () =>
      fetchAll<IdleTicket>(() =>
        supabase.from("sgf_tickets").select("employee_id,emitida_em,inicio_em,fim_em,estado,espera_s,atendimento_s")
          .gte("emitida_em", `${start}T00:00:00`).lte("emitida_em", `${end}T23:59:59`),
      ),
  });

  const shiftsQ = useQuery({
    queryKey: ["shift_days", "ociosidade", start, end],
    queryFn: () =>
      fetchAll<Shift2>(() =>
        supabase.from("shift_days").select("employee_id,data,descricao,estado,horas").gte("data", start).lte("data", end),
      ),
  });

  const slotsQ = useQuery({
    queryKey: ["telemarketing", start, end],
    queryFn: () =>
      fetchAll<Slot>(() =>
        supabase.from("telemarketing_slots").select("id,employee_id,data,hora,feito,vendas").gte("data", start).lte("data", end),
      ),
  });

  const lunchMap = useMemo(() => {
    const m = new Map<string, LunchWindow>();
    for (const s of shiftsQ.data ?? []) {
      const w = parseLunch(s.descricao, s.data);
      if (w) m.set(`${s.employee_id}|${s.data}`, w);
    }
    return m;
  }, [shiftsQ.data]);

  /** Horas de telemarketing feitas por colaborador/dia (descontadas da ociosidade). */
  const teleDoneMap = useMemo(() => {
    const m = new Map<string, Set<number>>();
    for (const s of slotsQ.data ?? []) {
      if (!s.feito) continue;
      const k = `${s.employee_id}|${s.data}`;
      const set = m.get(k) ?? new Set<number>();
      set.add(s.hora);
      m.set(k, set);
    }
    return m;
  }, [slotsQ.data]);

  const dayRows = useMemo(
    () => computeIdleDaily(ticketsQ.data ?? [], config, lunchMap, teleDoneMap).filter((r) => empMap.has(r.employeeId)),
    [ticketsQ.data, config, lunchMap, teleDoneMap, empMap],
  );

  const filteredRows = useMemo(
    () => (empFilter ? dayRows.filter((r) => r.employeeId === empFilter) : dayRows),
    [dayRows, empFilter],
  );

  // Resumo do mês por colaborador
  type Sum = {
    employeeId: string; nome: string; dias: number; atendimentos: number;
    manhaS: number; manhaC: number; tardeS: number; tardeC: number;
    totalS: number; count: number; maxS: number; almocoS: number; teleS: number; janelaS: number; atendimentoS: number;
  };
  const resumo = useMemo(() => {
    const m = new Map<string, Sum>();
    for (const r of filteredRows) {
      const cur = m.get(r.employeeId) ?? {
        employeeId: r.employeeId, nome: empMap.get(r.employeeId)?.nome ?? "—",
        dias: 0, atendimentos: 0, manhaS: 0, manhaC: 0, tardeS: 0, tardeC: 0,
        totalS: 0, count: 0, maxS: 0, almocoS: 0, teleS: 0, janelaS: 0, atendimentoS: 0,
      };
      cur.dias += 1;
      cur.atendimentos += r.atendimentos;
      cur.manhaS += r.manha.idleS; cur.manhaC += r.manha.count;
      cur.tardeS += r.tarde.idleS; cur.tardeC += r.tarde.count;
      cur.totalS += r.totalS; cur.count += r.count;
      cur.maxS = Math.max(cur.maxS, r.maxS);
      cur.almocoS += r.almocoS; cur.teleS += r.teleS; cur.janelaS += r.janelaS; cur.atendimentoS += r.atendimentoS;
      m.set(r.employeeId, cur);
    }
    return Array.from(m.values()).sort((a, b) => b.totalS - a.totalS);
  }, [filteredRows, empMap]);

  const totals = useMemo(() => {
    const t = { totalS: 0, manhaS: 0, tardeS: 0, count: 0, janelaS: 0, atendimentoS: 0, almocoS: 0, teleS: 0 };
    for (const r of resumo) {
      t.totalS += r.totalS; t.manhaS += r.manhaS; t.tardeS += r.tardeS;
      t.count += r.count; t.janelaS += r.janelaS; t.atendimentoS += r.atendimentoS; t.almocoS += r.almocoS; t.teleS += r.teleS;
    }
    return t;
  }, [resumo]);

  // ---- Telemarketing (janelas fixas: 12h-14h e 15h-19h) ----
  const hours = TELE_HOURS;

  /** Turno de cada colaborador por dia. */
  const shiftMap = useMemo(() => {
    const m = new Map<string, Shift2>();
    for (const s of shiftsQ.data ?? []) m.set(`${s.employee_id}|${s.data}`, s);
    return m;
  }, [shiftsQ.data]);

  const hasShiftsForDay = useMemo(
    () => (shiftsQ.data ?? []).some((s) => s.data === iso),
    [shiftsQ.data, iso],
  );

  const available = (empId: string, isoD: string, h: number) => {
    const sh = shiftMap.get(`${empId}|${isoD}`);
    if (!sh) return !(shiftsQ.data ?? []).some((s) => s.data === isoD);
    return slotIsAvailable(sh.descricao, sh.estado, h);
  };

  const slotKey = (empId: string, isoD: string, h: number) => `${empId}|${isoD}|${h}`;
  const slotMap = useMemo(() => {
    const m = new Map<string, Slot>();
    for (const s of slotsQ.data ?? []) m.set(slotKey(s.employee_id, s.data, s.hora), s);
    return m;
  }, [slotsQ.data]);

  const saveSlot = useMutation({
    mutationFn: async (v: { employee_id: string; data: string; hora: number; feito: boolean; vendas: number }) => {
      if (!v.feito && v.vendas === 0) {
        const { error } = await supabase.from("telemarketing_slots").delete()
          .eq("employee_id", v.employee_id).eq("data", v.data).eq("hora", v.hora);
        if (error) throw error;
        return;
      }
      const { error } = await supabase.from("telemarketing_slots")
        .upsert(v, { onConflict: "employee_id,data,hora" });
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["telemarketing"] }),
    onError: (e: any) => toast.error(e?.message ?? "Não foi possível guardar."),
  });

  /** Só entram no quadro do dia os colaboradores escalados (se houver horário importado). */
  const teleDia = useMemo(() => {
    return employees
      .filter((e) => {
        if (!hasShiftsForDay) return true;
        const sh = shiftMap.get(`${e.id}|${iso}`);
        return !!sh && isWorkingState(sh.estado, sh.descricao);
      })
      .map((e) => {
        let feitos = 0, vendas = 0, disponiveis = 0;
        for (const h of hours) {
          const ok = available(e.id, iso, h);
          if (ok) disponiveis += 1;
          const s = slotMap.get(slotKey(e.id, iso, h));
          if (s?.feito) feitos += 1;
          vendas += s?.vendas ?? 0;
        }
        const sh = shiftMap.get(`${e.id}|${iso}`);
        return {
          e, feitos, vendas, disponiveis,
          turno: sh?.descricao ?? "",
          taxa: disponiveis ? (feitos / disponiveis) * 100 : 0,
        };
      });
  }, [employees, hasShiftsForDay, shiftMap, slotMap, iso, hours]);

  /** Slots disponíveis no mês por colaborador (para taxas corretas). */
  const dispMes = useMemo(() => {
    const m = new Map<string, number>();
    for (const s of shiftsQ.data ?? []) {
      if (!isWorkingState(s.estado, s.descricao)) continue;
      let n = 0;
      for (const h of hours) if (slotIsAvailable(s.descricao, s.estado, h)) n += 1;
      m.set(s.employee_id, (m.get(s.employee_id) ?? 0) + n);
    }
    return m;
  }, [shiftsQ.data, hours]);

  const teleMes = useMemo(() => {
    const m = new Map<string, { feitos: number; vendas: number; dias: Set<string> }>();
    for (const s of slotsQ.data ?? []) {
      if (empFilter && s.employee_id !== empFilter) continue;
      const cur = m.get(s.employee_id) ?? { feitos: 0, vendas: 0, dias: new Set<string>() };
      if (s.feito) { cur.feitos += 1; cur.dias.add(s.data); }
      cur.vendas += s.vendas ?? 0;
      m.set(s.employee_id, cur);
    }
    return Array.from(m.entries())
      .filter(([id]) => empMap.has(id))
      .map(([id, v]) => {
        const disp = dispMes.get(id) ?? 0;
        return {
          id, nome: empMap.get(id)!.nome, feitos: v.feitos, vendas: v.vendas, dias: v.dias.size,
          disponiveis: disp, taxa: disp ? (v.feitos / disp) * 100 : 0,
        };
      })
      .sort((a, b) => b.feitos - a.feitos);
  }, [slotsQ.data, empMap, empFilter, dispMes]);

  const teleHora = useMemo(() => {
    const m = new Map<number, { feitos: number; vendas: number }>();
    for (const h of hours) m.set(h, { feitos: 0, vendas: 0 });
    for (const s of slotsQ.data ?? []) {
      if (empFilter && s.employee_id !== empFilter) continue;
      const cur = m.get(s.hora);
      if (!cur) continue;
      if (s.feito) cur.feitos += 1;
      cur.vendas += s.vendas ?? 0;
    }
    return hours.map((h) => ({ h, ...m.get(h)! }));
  }, [slotsQ.data, hours, empFilter]);

  const dispDia = teleDia.reduce((a, b) => a + b.disponiveis, 0);

  const loading = empQ.isLoading || ticketsQ.isLoading;

  return (
    <div className="min-h-full">
      <PageHeader
        title="Ociosidade & Telemarketing"
        subtitle={`${MONTHS_PT[month - 1]} ${year}`}
        actions={
          <>
            <MonthDayPicker year={year} month={month} day={day} onChange={setDate} />
            <select
              value={empFilter}
              onChange={(e) => setEmpFilter(e.target.value)}
              className="rounded-md border bg-background px-2 py-1.5 text-xs font-medium"
              aria-label="Colaborador"
            >
              <option value="">Todos os colaboradores</option>
              {employees.map((e) => <option key={e.id} value={e.id}>{e.nome}</option>)}
            </select>
            <button
              onClick={() => setShowCfg((v) => !v)}
              className="inline-flex items-center gap-1 rounded-md border px-2 py-1.5 text-xs font-semibold hover:bg-accent"
            >
              <Settings2 className="h-3.5 w-3.5" /> Limites
            </button>
          </>
        }
      />

      {showCfg && (
        <div className="mx-3 mt-3 rounded-lg border bg-card p-3 shadow-sm">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
            <NumField label="Corte de pausa (min)" value={config.maxGapMin} min={5} max={480}
              onChange={(v) => update({ maxGapMin: v })} hint="Intervalos maiores são ignorados" />
            <NumField label="Aviso de inatividade (min)" value={config.alertMin} min={1} max={240}
              onChange={(v) => update({ alertMin: v })} hint="Alerta de quem está parado" />
            <NumField label="Corte manhã/tarde (h)" value={config.splitHour} min={0} max={23}
              onChange={(v) => update({ splitHour: v })} hint="Hora que separa períodos" />
            <div className="flex flex-col justify-center gap-1 rounded-md border p-2 text-[11px] font-semibold">
              <span className="uppercase tracking-wide text-foreground/70">Telemarketing</span>
              <span className="text-[10px] font-normal text-foreground/55">
                Janelas fixas: {TELE_WINDOWS.map(([a, b]) => `${a}h–${b}h`).join(" e ")}
              </span>
            </div>
            <label className="flex flex-col justify-center gap-1 rounded-md border p-2 text-[11px] font-semibold">
              <span className="uppercase tracking-wide text-foreground/70">Almoço escalado</span>
              <span className="flex items-center gap-2">
                <input type="checkbox" checked={config.excluirAlmoco}
                  onChange={(e) => update({ excluirAlmoco: e.target.checked })} />
                Descontar automaticamente
              </span>
            </label>
            <label className="flex flex-col justify-center gap-1 rounded-md border p-2 text-[11px] font-semibold">
              <span className="uppercase tracking-wide text-foreground/70">Telemarketing feito</span>
              <span className="flex items-center gap-2">
                <input type="checkbox" checked={config.excluirTele}
                  onChange={(e) => update({ excluirTele: e.target.checked })} />
                Descontar da ociosidade
              </span>
            </label>
          </div>
          <button onClick={reset} className="mt-2 inline-flex items-center gap-1 rounded-md border px-2 py-1 text-[11px] font-semibold hover:bg-accent">
            <RotateCcw className="h-3 w-3" /> Repor valores por omissão
          </button>
        </div>
      )}

      <div className="mx-3 mt-3 flex gap-1.5">
        {(["ociosidade", "telemarketing"] as const).map((t) => (
          <button key={t} onClick={() => setTab(t)}
            className={classNames(
              "inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-xs font-bold uppercase tracking-wide",
              tab === t ? "bg-primary text-primary-foreground border-primary" : "hover:bg-accent",
            )}>
            {t === "ociosidade" ? <Coffee className="h-3.5 w-3.5" /> : <Phone className="h-3.5 w-3.5" />}
            {t === "ociosidade" ? "Ociosidade" : "Telemarketing"}
          </button>
        ))}
      </div>

      {tab === "ociosidade" ? (
        <div className="space-y-3 p-3">
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-7">
            <Kpi label="Tempo morto total" value={fmtDur(totals.totalS)} color="var(--neon-yellow)" />
            <Kpi label="Manhã" value={fmtDur(totals.manhaS)} color="var(--neon-blue)" />
            <Kpi label="Tarde" value={fmtDur(totals.tardeS)} color="var(--neon-pink)" />
            <Kpi label="Intervalos válidos" value={String(totals.count)} color="var(--neon-green)" />
            <Kpi label="Almoço descontado" value={fmtDur(totals.almocoS)} color="var(--neon-orange)" />
            <Kpi label="Tele descontado" value={fmtDur(totals.teleS)} color="var(--neon-green)" />
            <Kpi
              label="Taxa de ociosidade"
              value={totals.janelaS > 0 ? pct((totals.totalS / totals.janelaS) * 100) : "—"}
              color="var(--neon-yellow)"
            />
          </div>

          <Card title="Resumo do mês por colaborador" color="var(--neon-yellow)"
            right={
              <button
                onClick={() => exportCsv(`ociosidade-resumo-${year}-${String(month).padStart(2, "0")}`,
                  resumo.map((r) => ({
                    Colaborador: r.nome, Dias: r.dias, Atendimentos: r.atendimentos,
                    "Ocioso manhã": fmtDur(r.manhaS), "Intervalos manhã": r.manhaC,
                    "Ocioso tarde": fmtDur(r.tardeS), "Intervalos tarde": r.tardeC,
                    "Ocioso total": fmtDur(r.totalS), Intervalos: r.count,
                    "Maior intervalo": fmtDur(r.maxS), "Almoço descontado": fmtDur(r.almocoS),
                    "Tele descontado": fmtDur(r.teleS),
                    "Taxa ociosidade": r.janelaS > 0 ? pct((r.totalS / r.janelaS) * 100) : "",
                  })))}
                disabled={!resumo.length}
                className="inline-flex items-center gap-1 rounded border border-black/20 bg-black/10 px-1.5 py-0.5 disabled:opacity-40">
                <Download className="h-3 w-3" /> CSV
              </button>
            }>
            <TableWrap>
              <thead className="bg-muted/60 text-[11px] uppercase tracking-wide">
                <tr>
                  <th className="px-2 py-1 text-left">Colaborador</th>
                  <th className="px-2 py-1 text-right">Dias</th>
                  <th className="px-2 py-1 text-right">Atend.</th>
                  <th className="px-2 py-1 text-right">Manhã</th>
                  <th className="px-2 py-1 text-right">#</th>
                  <th className="px-2 py-1 text-right">Tarde</th>
                  <th className="px-2 py-1 text-right">#</th>
                  <th className="px-2 py-1 text-right">Total</th>
                  <th className="px-2 py-1 text-right">Média</th>
                  <th className="px-2 py-1 text-right">Máx.</th>
                  <th className="px-2 py-1 text-right">Almoço</th>
                  <th className="px-2 py-1 text-right">Taxa</th>
                </tr>
              </thead>
              <tbody>
                {resumo.map((r) => (
                  <tr key={r.employeeId} className="border-t hover:bg-accent/40">
                    <td className="px-2 py-1 font-semibold">{r.nome}</td>
                    <td className="px-2 py-1 text-right tabular-nums">{r.dias}</td>
                    <td className="px-2 py-1 text-right tabular-nums">{r.atendimentos}</td>
                    <td className="px-2 py-1 text-right tabular-nums">{fmtDur(r.manhaS)}</td>
                    <td className="px-2 py-1 text-right tabular-nums text-foreground/60">{r.manhaC}</td>
                    <td className="px-2 py-1 text-right tabular-nums">{fmtDur(r.tardeS)}</td>
                    <td className="px-2 py-1 text-right tabular-nums text-foreground/60">{r.tardeC}</td>
                    <td className="px-2 py-1 text-right tabular-nums font-bold">{fmtDur(r.totalS)}</td>
                    <td className="px-2 py-1 text-right tabular-nums">{fmtDur(r.count ? Math.round(r.totalS / r.count) : 0)}</td>
                    <td className="px-2 py-1 text-right tabular-nums">{fmtDur(r.maxS)}</td>
                    <td className="px-2 py-1 text-right tabular-nums text-foreground/60">{fmtDur(r.almocoS)}</td>
                    <td className="px-2 py-1 text-right tabular-nums font-semibold">
                      {r.janelaS > 0 ? pct((r.totalS / r.janelaS) * 100) : "—"}
                    </td>
                  </tr>
                ))}
                {!resumo.length && (
                  <tr><td colSpan={12} className="px-2 py-6 text-center text-foreground/60">
                    {loading ? "A carregar…" : "Sem dados para o período."}
                  </td></tr>
                )}
              </tbody>
            </TableWrap>
            <TableLegend
              items={[
                { term: "Dias", desc: "Dias do mês com senhas terminadas." },
                { term: "Atend.", desc: "Total de senhas terminadas no mês." },
                { term: "Manhã / Tarde", desc: "Tempo morto acumulado em cada período (corte às " + config.splitHour + "h)." },
                { term: "#", desc: "Número de intervalos válidos contados (pausas >" + config.maxGapMin + " min são ignoradas)." },
                { term: "Total", desc: "Soma do tempo morto manhã + tarde." },
                { term: "Média", desc: "Tempo médio por intervalo válido." },
                { term: "Máx.", desc: "Maior intervalo contínuo de tempo morto." },
                { term: "Almoço", desc: "Tempo de almoço escalado descontado automaticamente." },
                { term: "Taxa", desc: "% de tempo morto sobre as janelas de telemarketing (12h–14h e 15h–19h)." },
              ]}
            />
          </Card>

        </div>
      ) : (
        <div className="space-y-3 p-3">
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <Kpi label="Slots disponíveis (dia)" value={String(dispDia)} color="var(--neon-blue)" />
            <Kpi label="Períodos feitos (dia)" value={String(teleDia.reduce((a, b) => a + b.feitos, 0))} color="var(--neon-green)" />
            <Kpi label="Vendas telemarketing (dia)" value={String(teleDia.reduce((a, b) => a + b.vendas, 0))} color="var(--neon-pink)" />
            <Kpi
              label="Taxa telemarketing (dia)"
              value={dispDia ? pct((teleDia.reduce((a, b) => a + b.feitos, 0) / dispDia) * 100) : "—"}
              color="var(--neon-yellow)"
            />
          </div>

          <Card title={`Registo hora a hora · ${iso.slice(8)}/${iso.slice(5, 7)}/${year}`} color="var(--neon-green)"
            right={
              <span className="inline-flex items-center gap-1">
                <Calendar className="h-3 w-3" />
                {TELE_WINDOWS.map(([a, b]) => `${a}h–${b}h`).join(" · ")} · só escalados
              </span>
            }>
            <div className="overflow-x-auto">
              <table className="min-w-full text-xs">
                <thead className="bg-muted/60 text-[11px] uppercase tracking-wide">
                  <tr>
                    <th className="sticky left-0 z-10 bg-muted/60 px-2 py-1 text-left">Colaborador</th>
                    {hours.map((h) => (
                      <th key={h} className="px-1 py-1 text-center tabular-nums">{String(h).padStart(2, "0")}h</th>
                    ))}
                    <th className="px-2 py-1 text-right">Feitos</th>
                    <th className="px-2 py-1 text-right">Slots</th>
                    <th className="px-2 py-1 text-right">Vendas</th>
                    <th className="px-2 py-1 text-right">Taxa</th>
                  </tr>
                </thead>
                <tbody>
                  {teleDia
                    .filter((row) => !empFilter || row.e.id === empFilter)
                    .map(({ e, feitos, vendas, taxa, disponiveis, turno }) => (
                      <tr key={e.id} className="border-t">
                        <td className="sticky left-0 z-10 bg-card px-2 py-1 whitespace-nowrap">
                          <span className="font-semibold">{e.nome}</span>
                          {turno && <span className="ml-1 text-[10px] text-foreground/55">{turno}</span>}
                        </td>
                        {hours.map((h) => {
                          const s = slotMap.get(slotKey(e.id, iso, h));
                          const feito = !!s?.feito;
                          const ok = available(e.id, iso, h);
                          if (!ok) {
                            return (
                              <td key={h} className="px-1 py-1 text-center align-middle text-foreground/30" title="Fora do turno ou ao almoço">—</td>
                            );
                          }
                          return (
                            <td key={h} className="px-1 py-1 text-center align-middle">
                              <button
                                type="button"
                                aria-label={`${e.nome} ${h}h`}
                                onClick={() => saveSlot.mutate({
                                  employee_id: e.id, data: iso, hora: h,
                                  feito: !feito, vendas: s?.vendas ?? 0,
                                })}
                                className={classNames(
                                  "grid h-6 w-6 place-items-center rounded border transition",
                                  feito ? "border-transparent bg-[color:var(--neon-green)] text-black" : "hover:bg-accent",
                                )}
                              >
                                {feito ? <Check className="h-3.5 w-3.5" /> : null}
                              </button>
                              <input
                                type="number"
                                min={0}
                                value={s?.vendas ?? 0}
                                onChange={(ev) => {
                                  const v = Math.max(0, Number(ev.target.value) || 0);
                                  saveSlot.mutate({ employee_id: e.id, data: iso, hora: h, feito: s?.feito ?? v > 0, vendas: v });
                                }}
                                className="mt-0.5 w-10 rounded border bg-background px-0.5 py-0.5 text-center text-[10px] tabular-nums"
                                aria-label={`Vendas ${e.nome} ${h}h`}
                              />
                            </td>
                          );
                        })}
                        <td className="px-2 py-1 text-right tabular-nums font-bold">{feitos}</td>
                        <td className="px-2 py-1 text-right tabular-nums text-foreground/60">{disponiveis}</td>
                        <td className="px-2 py-1 text-right tabular-nums font-bold">{vendas}</td>
                        <td className="px-2 py-1 text-right tabular-nums">{pct(taxa)}</td>
                      </tr>
                    ))}
                  {!teleDia.length && (
                    <tr><td colSpan={hours.length + 5} className="px-2 py-6 text-center text-foreground/60">
                      Sem colaboradores escalados neste dia.
                    </td></tr>
                  )}
                </tbody>
              </table>
            </div>
            <p className="border-t px-2 py-1.5 text-[11px] text-foreground/60">
              As vendas registadas aqui são apenas informativas — não contam para pontos, TEP ou rankings.
            </p>
          </Card>

          <Card title={`Mês · ${MONTHS_PT[month - 1]} ${year}`} color="var(--neon-pink)"
            right={
              <button
                onClick={() => exportCsv(`telemarketing-${year}-${String(month).padStart(2, "0")}`,
                  teleMes.map((r) => ({ Colaborador: r.nome, "Períodos feitos": r.feitos, "Dias com registo": r.dias, Vendas: r.vendas })))}
                disabled={!teleMes.length}
                className="inline-flex items-center gap-1 rounded border border-black/20 bg-black/10 px-1.5 py-0.5 disabled:opacity-40">
                <Download className="h-3 w-3" /> CSV
              </button>
            }>
            <div className="grid gap-3 md:grid-cols-2">
              <TableWrap>
                <thead className="bg-muted/60 text-[11px] uppercase tracking-wide">
                  <tr>
                    <th className="px-2 py-1 text-left">Colaborador</th>
                    <th className="px-2 py-1 text-right">Períodos</th>
                    <th className="px-2 py-1 text-right">Slots</th>
                    <th className="px-2 py-1 text-right">Taxa</th>
                    <th className="px-2 py-1 text-right">Dias</th>
                    <th className="px-2 py-1 text-right">Vendas</th>
                  </tr>
                </thead>
                <tbody>
                  {teleMes.map((r) => (
                    <tr key={r.id} className="border-t">
                      <td className="px-2 py-1 font-semibold">{r.nome}</td>
                      <td className="px-2 py-1 text-right tabular-nums">{r.feitos}</td>
                      <td className="px-2 py-1 text-right tabular-nums text-foreground/60">{r.disponiveis}</td>
                      <td className="px-2 py-1 text-right tabular-nums">{r.disponiveis ? pct(r.taxa) : "—"}</td>
                      <td className="px-2 py-1 text-right tabular-nums">{r.dias}</td>
                      <td className="px-2 py-1 text-right tabular-nums font-bold">{r.vendas}</td>
                    </tr>
                  ))}
                  {!teleMes.length && (
                    <tr><td colSpan={6} className="px-2 py-6 text-center text-foreground/60">Sem registos este mês.</td></tr>
                  )}
                </tbody>
              </TableWrap>
              <TableWrap>
                <thead className="bg-muted/60 text-[11px] uppercase tracking-wide">
                  <tr>
                    <th className="px-2 py-1 text-left">Período</th>
                    <th className="px-2 py-1 text-right">Períodos feitos</th>
                    <th className="px-2 py-1 text-right">Vendas</th>
                  </tr>
                </thead>
                <tbody>
                  {teleHora.map((r) => (
                    <tr key={r.h} className="border-t">
                      <td className="px-2 py-1 tabular-nums">{String(r.h).padStart(2, "0")}h–{String(r.h + 1).padStart(2, "0")}h</td>
                      <td className="px-2 py-1 text-right tabular-nums">{r.feitos}</td>
                      <td className="px-2 py-1 text-right tabular-nums font-bold">{r.vendas}</td>
                    </tr>
                  ))}
                </tbody>
              </TableWrap>
            </div>
          </Card>
        </div>
      )}
    </div>
  );
}

function NumField({
  label, value, onChange, min, max, hint,
}: { label: string; value: number; onChange: (v: number) => void; min: number; max: number; hint?: string }) {
  return (
    <label className="flex flex-col gap-1 rounded-md border p-2 text-[11px] font-semibold">
      <span className="uppercase tracking-wide text-foreground/70">{label}</span>
      <input
        type="number" min={min} max={max} value={value}
        onChange={(e) => {
          const n = Number(e.target.value);
          if (!isNaN(n)) onChange(Math.min(max, Math.max(min, Math.round(n))));
        }}
        className="rounded border bg-background px-2 py-1 text-sm tabular-nums"
      />
      {hint && <span className="text-[10px] font-normal text-foreground/55">{hint}</span>}
    </label>
  );
}

function Kpi({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <div className="rounded-lg border bg-card p-2.5 shadow-sm"
      style={{ borderColor: `color-mix(in oklab, ${color} 45%, transparent)` }}>
      <div className="text-[10px] font-bold uppercase tracking-widest text-foreground/60">{label}</div>
      <div className="mt-0.5 text-lg font-extrabold tabular-nums" style={{ color }}>{value}</div>
    </div>
  );
}

function Card({
  title, color, right, children,
}: { title: string; color: string; right?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="overflow-hidden rounded-lg border bg-card shadow-sm"
      style={{ borderColor: `color-mix(in oklab, ${color} 45%, transparent)` }}>
      <header className="flex items-center justify-between gap-2 px-2.5 py-1"
        style={{ background: `linear-gradient(90deg, ${color}, color-mix(in oklab, ${color} 55%, black))` }}>
        <h2 className="text-[10px] font-bold uppercase tracking-widest text-black/85">{title}</h2>
        {right && <span className="text-[10px] font-semibold text-black/80">{right}</span>}
      </header>
      {children}
    </section>
  );
}

function TableWrap({ children }: { children: React.ReactNode }) {
  return (
    <div className="overflow-x-auto">
      <table className="min-w-full text-xs">{children}</table>
    </div>
  );
}

function TableLegend({ items }: { items: { term: string; desc: string }[] }) {
  return (
    <div className="border-t bg-muted/30 px-3 py-2">
      <p className="mb-1 text-[10px] font-bold uppercase tracking-wide text-foreground/60">Legenda das colunas</p>
      <ul className="grid gap-x-3 gap-y-1 text-[11px] text-foreground/70 sm:grid-cols-2 lg:grid-cols-3">
        {items.map((it) => (
          <li key={it.term} className="flex gap-1.5">
            <span className="shrink-0 font-semibold text-foreground/90">{it.term}:</span>
            <span>{it.desc}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
