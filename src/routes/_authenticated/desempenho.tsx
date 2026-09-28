import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { RouteError, RouteNotFound } from "@/components/RouteBoundary";
import { useCallback, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { z } from "zod";
import {
  LineChart, Line, BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer,
  CartesianGrid, PieChart, Pie, Cell, Legend,
} from "recharts";
import {
  TrendingUp, TrendingDown, Package, Ticket, Timer, Clock, Ban, LogIn,
  Users, User, Download, Copy, Trophy, AlertTriangle, ArrowUpDown, Calendar,
  Medal, Target, PieChart as PieIcon, LineChart as LineIcon, Grid3x3,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { withoutManagers } from "@/lib/manager";
import { computeIdle, fmtDur, IDLE_ALERT_MIN, IDLE_MAX_GAP_MIN, type IdleTicket } from "@/lib/idle";
import { exportCsv } from "@/lib/export-csv";
import { isMedicalLeave } from "@/lib/shift-state";
import { PageHeader } from "@/components/AppShell";
import { MONTHS_PT, fmtNum, fmtSecsAsTime, monthRange, classNames } from "@/lib/domain";

const searchSchema = z.object({
  y: z.number().int().optional(),
  m: z.number().int().optional(),
  emp: z.string().optional(),
  cat: z.string().optional(),
  sort: z.string().optional(),
  dir: z.enum(["asc", "desc"]).optional(),
  folgas: z.boolean().optional(),
  nc: z.boolean().optional(), // false = excluir NC + Combina do ponderado/%TEP (default: incluir)

});

export const Route = createFileRoute("/_authenticated/desempenho")({
  errorComponent: ({ error, reset }) => <RouteError error={error} reset={reset} />,
  notFoundComponent: () => <RouteNotFound />,
  validateSearch: (raw) => searchSchema.parse(raw),
  head: () => ({
    meta: [
      { title: "Desempenho — Vendas, Senhas e TEPs" },
      { name: "description", content: "Análise mensal de vendas, senhas e TEPs por colaborador e loja." },
    ],
  }),
  component: DesempenhoPage,
});

type Employee = { id: string; nome: string; slug: string; ativo: boolean; ordem: number; categoria: string | null; objetivo_mes: number | null };
type Product = { id: string; codigo: string; nome: string; peso: number };
type Sale = { employee_id: string; product_id: string; data: string; quantidade: number };
type SgfTicket = {
  employee_id: string | null;
  estado: string | null;
  espera_s: number | null;
  atendimento_s: number | null;
  emitida_em: string | null;
};
type ShiftDay = { employee_id: string; data: string; horas: number | null; estado: string | null; descricao: string | null };

const FIXO_CODES = new Set(["tv", "net", "voz", "wifi-total", "migracoes", "migracoes-tv"]);
const MOVEL_CODES = new Set(["cv", "cv-por-retencao", "pp", "pre-pagos"]);
const MARCACOES_CODES = new Set(["sm-1a", "sm-2a", "sm-1a-estrela", "sm-2a-estrela", "sm-1a-movel", "sm-2a-movel", "xpert", "ecn", "premium", "segue-retencao"]);
const NEGOCIO_CODES = new Set(["alarmes", "alarme", "smp", "smp-retoma", "acess", "pelicula", "seguro", "seg-fat", "device", "hotspot", "energia", "energia-sa"]);
// Códigos "auxiliares" (NC = novos contratos, Combina = continente).
// Por defeito contam no ponderado/%TEP; o utilizador pode excluí-los com o toggle.
const OPTIONAL_PTS_CODES = new Set<string>(["combina", "nc"]);




type CatKey = "fixo" | "movel" | "marcacoes" | "negocio" | "nc" | "combina";
const CAT_META: Record<CatKey, { label: string; color: string }> = {
  fixo: { label: "Fixo", color: "var(--neon-yellow)" },
  movel: { label: "Móvel", color: "var(--neon-blue)" },
  marcacoes: { label: "Marcações", color: "var(--neon-violet)" },
  negocio: { label: "+Negócio", color: "var(--neon-orange)" },
  nc: { label: "NC", color: "var(--neon-green)" },
  combina: { label: "Combina", color: "var(--neon-pink)" },
};

// Target %TEP thresholds per categoria — para semáforo
const TEP_TARGET: Record<CatKey, number> = { fixo: 60, movel: 40, marcacoes: 30, negocio: 40, nc: 20, combina: 10 };
const TURNO_SPLIT_HOUR = 14; // manhã < 14h <= tarde
const TMA_ALERT_S = 25 * 60; // > 25 min = alerta
const ATT_ALERT_PCT = 70;    // < 70% atendimento = alerta

function categorize(code: string): CatKey | null {
  const c = code.toLowerCase();
  if (c === "nc") return "nc";
  if (c === "combina") return "combina";
  if (FIXO_CODES.has(c)) return "fixo";
  if (MOVEL_CODES.has(c)) return "movel";
  if (MARCACOES_CODES.has(c)) return "marcacoes";
  if (NEGOCIO_CODES.has(c)) return "negocio";
  return null;
}

function prevMonth(y: number, m: number) {
  return m === 1 ? { y: y - 1, m: 12 } : { y, m: m - 1 };
}

function csvEscape(v: unknown) {
  const s = String(v ?? "");
  return /[",;\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
function downloadCSV(name: string, rows: (string | number)[][]) {
  const csv = rows.map((r) => r.map(csvEscape).join(";")).join("\n");
  const blob = new Blob(["\ufeff" + csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = name; a.click();
  URL.revokeObjectURL(url);
}

function DesempenhoPage() {
  const navigate = useNavigate({ from: Route.fullPath });
  const search = Route.useSearch();
  const now = new Date();
  const year = search.y ?? now.getFullYear();
  const month = search.m ?? now.getMonth() + 1;
  const empId = search.emp ?? "";
  const catFilter = search.cat ?? "";
  const sortKey = search.sort ?? "pts";
  const sortDir = search.dir ?? "desc";
  const excludeFolgas = !!search.folgas;
  const includeNC = search.nc !== false; // default: incluir NC + Combina
  const excludedFromPts = useMemo(
    () => (includeNC ? new Set<string>() : OPTIONAL_PTS_CODES),
    [includeNC],
  );
  // Quando incluídos, NC e Combina contam como 1 ponto por unidade (peso 0 na BD).
  const effectivePeso = useCallback(
    (code: string, peso: number | null | undefined) => {
      if (includeNC && OPTIONAL_PTS_CODES.has(code)) return 1;
      return Number(peso ?? 0);
    },
    [includeNC],
  );


  const setSearch = (patch: Partial<z.infer<typeof searchSchema>>) => {
    navigate({ search: (prev: Record<string, unknown>) => ({ ...prev, ...patch }) as never, replace: true });
  };

  const { start, end, days } = useMemo(() => monthRange(year, month), [year, month]);
  const prev = useMemo(() => prevMonth(year, month), [year, month]);
  const prevRange = useMemo(() => monthRange(prev.y, prev.m), [prev]);

  // Supabase limita cada select a 1000 linhas por default. Paginar em blocos de 1000.
  async function fetchAllRows<T>(
    build: () => any,
  ): Promise<T[]> {
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


  const empQ = useQuery({
    queryKey: ["employees-active-obj"],
    queryFn: async () => {
      const { data } = await supabase.from("employees").select("id,nome,slug,username_sgf,ativo,ordem,categoria,objetivo_mes").eq("ativo", true).order("ordem");
      return withoutManagers((data ?? []) as any) as Employee[];
    },
  });
  const prodsQ = useQuery({
    queryKey: ["products-all"],
    queryFn: async () => {
      const { data } = await supabase.from("products").select("id,codigo,nome,peso");
      return (data ?? []) as Product[];
    },
  });
  const salesQ = useQuery({
    queryKey: ["desempenho-sales", start, end, empId],
    queryFn: async () => {
      return await fetchAllRows<Sale>(() => {
        let q = supabase.from("sales_entries").select("employee_id,product_id,data,quantidade").gte("data", start).lte("data", end);
        if (empId) q = q.eq("employee_id", empId);
        return q;
      });
    },
  });
  const sgfQ = useQuery({
    queryKey: ["desempenho-sgf", start, end, empId],
    queryFn: async () => {
      return await fetchAllRows<SgfTicket>(() => {
        let q = supabase.from("sgf_tickets").select("employee_id,estado,espera_s,atendimento_s,emitida_em")
          .gte("emitida_em", start + "T00:00:00").lte("emitida_em", end + "T23:59:59");
        if (empId) q = q.eq("employee_id", empId);
        return q;
      });
    },
  });
  const shiftQ = useQuery({
    queryKey: ["desempenho-shifts", start, end, empId],
    queryFn: async () => {
      return await fetchAllRows<ShiftDay>(() => {
        let q = supabase.from("shift_days").select("employee_id,data,horas,estado,descricao").gte("data", start).lte("data", end);
        if (empId) q = q.eq("employee_id", empId);
        return q;
      });
    },
  });
  // Mês anterior (só o essencial para Δ)
  const salesPrevQ = useQuery({
    queryKey: ["desempenho-sales-prev", prevRange.start, prevRange.end, empId],
    queryFn: async () => {
      return await fetchAllRows<Sale>(() => {
        let q = supabase.from("sales_entries").select("employee_id,product_id,quantidade").gte("data", prevRange.start).lte("data", prevRange.end);
        if (empId) q = q.eq("employee_id", empId);
        return q;
      });
    },
  });
  const sgfPrevQ = useQuery({
    queryKey: ["desempenho-sgf-prev", prevRange.start, prevRange.end, empId],
    queryFn: async () => {
      return await fetchAllRows<SgfTicket>(() => {
        let q = supabase.from("sgf_tickets").select("employee_id,estado,espera_s,atendimento_s")
          .gte("emitida_em", prevRange.start + "T00:00:00").lte("emitida_em", prevRange.end + "T23:59:59");
        if (empId) q = q.eq("employee_id", empId);
        return q;
      });
    },
  });


  const employees = empQ.data ?? [];
  const products = prodsQ.data ?? [];
  const sales = salesQ.data ?? [];
  const sgf = sgfQ.data ?? [];
  const shifts = shiftQ.data ?? [];
  const salesPrev = salesPrevQ.data ?? [];
  const sgfPrev = sgfPrevQ.data ?? [];

  const prodMap = useMemo(() => new Map(products.map((p) => [p.id, p])), [products]);
  const empMap = useMemo(() => new Map(employees.map((e) => [e.id, e])), [employees]);

  // set: emp|date que são folga (horas <= 0 ou estado presente)
  const folgaSet = useMemo(() => {
    const s = new Set<string>();
    for (const sh of shifts) {
      const isFolga = isMedicalLeave(sh) || (sh.horas ?? 0) <= 0 || (sh.estado && sh.estado.trim() !== "");
      if (isFolga) s.add(`${sh.employee_id}|${sh.data}`);
    }
    return s;
  }, [shifts]);

  const isTicketFolga = (t: SgfTicket) => {
    if (!excludeFolgas || !t.employee_id || !t.emitida_em) return false;
    const iso = t.emitida_em.slice(0, 10);
    return folgaSet.has(`${t.employee_id}|${iso}`);
  };

  // Horas escaladas (soma)
  const horasEscaladas = useMemo(() => shifts.reduce((a, s) => a + Math.max(0, Number(s.horas ?? 0)), 0), [shifts]);

  // === Tendência: últimos 6 meses ===
  const trendMonths = useMemo(() => {
    const arr: { y: number; m: number; start: string; end: string; label: string }[] = [];
    let ty = year, tm = month;
    for (let i = 0; i < 6; i++) {
      const r = monthRange(ty, tm);
      arr.push({ y: ty, m: tm, start: r.start, end: r.end, label: `${MONTHS_PT[tm - 1].slice(0, 3)}/${String(ty).slice(2)}` });
      const p = prevMonth(ty, tm); ty = p.y; tm = p.m;
    }
    return arr.reverse();
  }, [year, month]);

  const trendStart = trendMonths[0]?.start ?? start;
  const trendEnd = trendMonths[trendMonths.length - 1]?.end ?? end;

  const trendSalesQ = useQuery({
    queryKey: ["trend-sales", trendStart, trendEnd, empId],
    queryFn: async () => {
      return await fetchAllRows<Sale>(() => {
        let q = supabase.from("sales_entries").select("employee_id,product_id,data,quantidade").gte("data", trendStart).lte("data", trendEnd);
        if (empId) q = q.eq("employee_id", empId);
        return q;
      });
    },
  });
  const trendSgfQ = useQuery({
    queryKey: ["trend-sgf", trendStart, trendEnd, empId],
    queryFn: async () => {
      return await fetchAllRows<SgfTicket>(() => {
        let q = supabase.from("sgf_tickets").select("employee_id,estado,emitida_em")
          .gte("emitida_em", trendStart + "T00:00:00").lte("emitida_em", trendEnd + "T23:59:59");
        if (empId) q = q.eq("employee_id", empId);
        return q;
      });
    },
  });

  const trendData = useMemo(() => {
    const salesArr = trendSalesQ.data ?? [];
    const sgfArr = trendSgfQ.data ?? [];
    return trendMonths.map((mo) => {
      const inRange = (iso: string) => iso >= mo.start && iso <= mo.end;
      let atendidos = 0, entrados = 0, cancelados = 0, pts = 0;
      for (const t of sgfArr) {
        if (!t.emitida_em) continue;
        const iso = t.emitida_em.slice(0, 10);
        if (!inRange(iso)) continue;
        entrados++;
        if (t.estado === "terminada") atendidos++;
        else if (t.estado === "cancelado") cancelados++;
      }
      for (const s of salesArr) {
        if (!inRange(s.data)) continue;
        const p = prodMap.get(s.product_id); if (!p) continue;
        const code = (p.codigo ?? "").toLowerCase();
        if (excludedFromPts.has(code)) continue;
        pts += Number(s.quantidade) * effectivePeso(code, p.peso);
      }
      const tep = atendidos > 0 ? (pts / atendidos) * 100 : 0;
      const cancelRate = entrados > 0 ? (cancelados / entrados) * 100 : 0;
      return { label: mo.label, atendidos, entrados, cancelados, pts, tep, cancelRate };

    });
  }, [trendMonths, trendSalesQ.data, trendSgfQ.data, prodMap, excludedFromPts]);

  // === Ranking mês anterior (para Δ posição) ===
  const prevRankMap = useMemo(() => {
    const map = new Map<string, number>();
    const arr = employees.map((e) => {
      let pts = 0;
      for (const s of salesPrev) {
        if (s.employee_id !== e.id) continue;
        const p = prodMap.get(s.product_id); if (!p) continue;
        const code = (p.codigo ?? "").toLowerCase();
        if (excludedFromPts.has(code)) continue;
        pts += Number(s.quantidade) * effectivePeso(code, p.peso);
      }

      return { id: e.id, pts };
    }).sort((a, b) => b.pts - a.pts);
    arr.forEach((r, i) => map.set(r.id, r.pts > 0 ? i + 1 : 0));
    return map;
  }, [employees, salesPrev, prodMap, excludedFromPts]);

  // === KPIs mensais ===
  const computeSummary = (sgfArr: SgfTicket[], salesArr: Sale[], filterFolga = false) => {
    const entrados = sgfArr.length;
    const atendidos = sgfArr.filter((t) => t.estado === "terminada").length;
    const cancelados = sgfArr.filter((t) => t.estado === "cancelado").length;
    const cancelRate = entrados > 0 ? (cancelados / entrados) * 100 : 0;
    const aRows = sgfArr.filter((t) => t.atendimento_s && !(filterFolga && isTicketFolga(t)));
    const tma = aRows.reduce((a, t) => a + (t.atendimento_s ?? 0), 0) / (aRows.length || 1);
    const wRows = sgfArr.filter((t) => t.espera_s);
    const tme = wRows.reduce((a, t) => a + (t.espera_s ?? 0), 0) / (wRows.length || 1);
    let qty = 0, pts = 0;
    for (const s of salesArr) {
      const p = prodMap.get(s.product_id);
      if (!p) continue;
      const q = Number(s.quantidade);
      qty += q;
      const code = (p.codigo ?? "").toLowerCase();
      if (excludedFromPts.has(code)) continue;
      pts += q * effectivePeso(code, p.peso);
    }

    const tep = atendidos > 0 ? (pts / atendidos) * 100 : 0;
    return { entrados, atendidos, cancelados, cancelRate, tma, tme, qty, pts, tep };
  };

  const kpis = useMemo(() => computeSummary(sgf, sales, true), [sgf, sales, prodMap, excludeFolgas, folgaSet, excludedFromPts]);
  const kpisPrev = useMemo(() => computeSummary(sgfPrev, salesPrev, false), [sgfPrev, salesPrev, prodMap, excludedFromPts]);


  const delta = (curr: number, prevV: number) => {
    if (!prevV) return null;
    return ((curr - prevV) / prevV) * 100;
  };

  // === Senhas dia-a-dia ===
  const perDay = useMemo(() => {
    const rows = Array.from({ length: days }, (_, i) => {
      const d = i + 1;
      const iso = `${year}-${String(month).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
      return { day: d, iso, entrados: 0, atendidos: 0, cancelados: 0 };
    });
    for (const t of sgf) {
      if (!t.emitida_em) continue;
      const d = new Date(t.emitida_em);
      if (isNaN(d.getTime())) continue;
      if (d.getFullYear() !== year || d.getMonth() + 1 !== month) continue;
      const idx = d.getDate() - 1;
      if (idx < 0 || idx >= rows.length) continue;
      rows[idx].entrados++;
      if (t.estado === "terminada") rows[idx].atendidos++;
      else if (t.estado === "cancelado") rows[idx].cancelados++;
    }
    return rows;
  }, [sgf, year, month, days]);

  // Melhor / pior dia (por atendidos, ignorando dias vazios)
  const bestDay = useMemo(() => {
    const filled = perDay.filter((r) => r.entrados > 0);
    if (!filled.length) return null;
    return filled.reduce((b, r) => (r.atendidos > b.atendidos ? r : b), filled[0]);
  }, [perDay]);
  const worstDay = useMemo(() => {
    const filled = perDay.filter((r) => r.entrados > 0);
    if (!filled.length) return null;
    return filled.reduce((b, r) => {
      const pct = r.atendidos / r.entrados;
      const bp = b.atendidos / b.entrados;
      return pct < bp ? r : b;
    }, filled[0]);
  }, [perDay]);

  // Sparkline data por KPI
  const sparkAtendidos = perDay.map((r) => ({ x: r.day, y: r.atendidos }));
  const sparkEntrados = perDay.map((r) => ({ x: r.day, y: r.entrados }));
  const sparkCancel = perDay.map((r) => ({ x: r.day, y: r.cancelados }));

  // === TEP por categoria ===
  const tepPorCategoria = useMemo(() => {
    const atendidos = kpis.atendidos;
    const catPts: Record<CatKey, number> = { fixo: 0, movel: 0, marcacoes: 0, negocio: 0, nc: 0, combina: 0 };
    const catQty: Record<CatKey, number> = { fixo: 0, movel: 0, marcacoes: 0, negocio: 0, nc: 0, combina: 0 };
    for (const s of sales) {
      const p = prodMap.get(s.product_id);
      if (!p) continue;
      const code = (p.codigo ?? "").toLowerCase();
      const key = categorize(code);
      if (!key) continue;
      const q = Number(s.quantidade);
      catPts[key] += q * effectivePeso(code, p.peso);
      catQty[key] += q;
    }
    return (Object.keys(CAT_META) as CatKey[]).map((k) => {
      const tep = atendidos > 0 ? (catPts[k] / atendidos) * 100 : 0;
      const target = TEP_TARGET[k];
      const semaforo: "ok" | "warn" | "bad" = tep >= target ? "ok" : tep >= target * 0.7 ? "warn" : "bad";
      return { key: k, label: CAT_META[k].label, color: CAT_META[k].color, qty: catQty[k], pts: catPts[k], tep, target, semaforo };
    });
  }, [sales, prodMap, kpis.atendidos, effectivePeso]);

  // === Lojista mensal ===
  const lojistaRows = useMemo(() => {
    if (empId) return [];
    const byEmpSgf = new Map<string, SgfTicket[]>();
    for (const t of sgf) {
      if (!t.employee_id) continue;
      const arr = byEmpSgf.get(t.employee_id) ?? [];
      arr.push(t);
      byEmpSgf.set(t.employee_id, arr);
    }
    const byEmpSales = new Map<string, Sale[]>();
    for (const s of sales) {
      const arr = byEmpSales.get(s.employee_id) ?? [];
      arr.push(s);
      byEmpSales.set(s.employee_id, arr);
    }
    const filtered = catFilter ? employees.filter((e) => (e.categoria ?? "") === catFilter) : employees;
    const rows = filtered.map((e) => {
      const ts = byEmpSgf.get(e.id) ?? [];
      const ss = byEmpSales.get(e.id) ?? [];
      const entrados = ts.length;
      const atendidos = ts.filter((x) => x.estado === "terminada").length;
      const cancelados = ts.filter((x) => x.estado === "cancelado").length;
      const aRows = ts.filter((x) => x.atendimento_s && !isTicketFolga(x));
      const tma = aRows.reduce((a, r) => a + (r.atendimento_s ?? 0), 0) / (aRows.length || 1);
      const catPts: Record<CatKey, number> = { fixo: 0, movel: 0, marcacoes: 0, negocio: 0, nc: 0, combina: 0 };
      let qty = 0, pts = 0;
      for (const s of ss) {
        const p = prodMap.get(s.product_id);
        if (!p) continue;
        const q = Number(s.quantidade);
        qty += q;
        const code = (p.codigo ?? "").toLowerCase();
        const key = categorize(code);
        if (key) catPts[key] += q * effectivePeso(code, p.peso);
        if (excludedFromPts.has(code)) continue;
        pts += q * effectivePeso(code, p.peso);
      }

      const tep = atendidos > 0 ? (pts / atendidos) * 100 : 0;
      const objetivo = Number(e.objetivo_mes ?? 0);
      const objetivoPct = objetivo > 0 ? (pts / objetivo) * 100 : null;
      return { e, entrados, atendidos, cancelados, tma, qty, pts, tep, catPts, objetivo, objetivoPct, rank: 0, prevRank: 0, deltaRank: null as number | null };
    });
    // rank atual por pts (desc)
    const byPts = [...rows].sort((a, b) => b.pts - a.pts);
    byPts.forEach((r, i) => { r.rank = r.pts > 0 ? i + 1 : 0; });
    for (const r of rows) {
      r.prevRank = prevRankMap.get(r.e.id) ?? 0;
      r.deltaRank = r.rank > 0 && r.prevRank > 0 ? r.prevRank - r.rank : null;
    }
    const dir = sortDir === "asc" ? 1 : -1;
    rows.sort((a, b) => {
      const g = (r: typeof rows[number]): number | string => {
        switch (sortKey) {
          case "nome": return r.e.nome;
          case "entrados": return r.entrados;
          case "atendidos": return r.atendidos;
          case "cancelados": return r.cancelados;
          case "tma": return r.tma;
          case "qty": return r.qty;
          case "tep": return r.tep;
          case "objetivo": return r.objetivoPct ?? -1;
          case "fixo": return r.catPts.fixo;
          case "movel": return r.catPts.movel;
          case "marcacoes": return r.catPts.marcacoes;
          case "negocio": return r.catPts.negocio;
          case "nc": return r.catPts.nc;
          default: return r.pts;
        }
      };
      const va = g(a), vb = g(b);
      if (typeof va === "string" && typeof vb === "string") return va.localeCompare(vb) * dir;
      return ((va as number) - (vb as number)) * dir;
    });
    return rows;
  }, [empId, employees, sgf, sales, prodMap, catFilter, sortKey, sortDir, folgaSet, excludeFolgas, excludedFromPts]);

  // === Categorias distintas para filtro ===
  const empCategorias = useMemo(() => {
    const s = new Set<string>();
    employees.forEach((e) => e.categoria && s.add(e.categoria));
    return Array.from(s).sort();
  }, [employees]);

  // === Mix de pontos por categoria (donut) ===
  const mixCategorias = useMemo(() => {
    return tepPorCategoria
      .filter((c) => c.pts > 0 && !excludedFromPts.has(c.key))
      .map((c) => ({ name: c.label, value: Number(c.pts.toFixed(2)), color: c.color, tep: c.tep }));

  }, [tepPorCategoria, excludedFromPts]);
  const mixTotal = useMemo(() => mixCategorias.reduce((a, c) => a + c.value, 0), [mixCategorias]);

  // === Heatmap dia-da-semana × hora (horas-pico) ===
  const dowHour = useMemo(() => {
    // grid[dow 0..6][hour 0..23]
    const grid: number[][] = Array.from({ length: 7 }, () => Array(24).fill(0));
    for (const t of sgf) {
      if (!t.emitida_em) continue;
      const d = new Date(t.emitida_em);
      if (isNaN(d.getTime())) continue;
      grid[d.getDay()][d.getHours()]++;
    }
    let max = 0;
    for (const row of grid) for (const v of row) if (v > max) max = v;
    // horas ativas: 8..22 (loja); reduzimos ruído
    const HOURS = Array.from({ length: 15 }, (_, i) => i + 8);
    return { grid, max, hours: HOURS };
  }, [sgf]);

  // === Turnos: manhã vs tarde (por colaborador) ===
  const turnoRows = useMemo(() => {
    type Acc = { at: number; sum: number; n: number };
    const mk = (): Acc => ({ at: 0, sum: 0, n: 0 });
    const map = new Map<string, { manha: Acc; tarde: Acc }>();
    for (const t of sgf) {
      if (!t.employee_id || !t.emitida_em) continue;
      if (!empMap.has(t.employee_id)) continue;
      const d = new Date(t.emitida_em);
      if (isNaN(d.getTime())) continue;
      const cur = map.get(t.employee_id) ?? { manha: mk(), tarde: mk() };
      const slot = d.getHours() < TURNO_SPLIT_HOUR ? cur.manha : cur.tarde;
      if (t.estado === "terminada") slot.at += 1;
      if (t.atendimento_s) { slot.sum += Number(t.atendimento_s); slot.n += 1; }
      map.set(t.employee_id, cur);
    }
    return Array.from(map.entries())
      .map(([id, v]) => {
        const nome = empMap.get(id)?.nome ?? "—";
        const slug = empMap.get(id)?.slug ?? "";
        const total = v.manha.at + v.tarde.at;
        return {
          id, nome, slug, total,
          manhaAt: v.manha.at,
          tardeAt: v.tarde.at,
          manhaTma: v.manha.n ? v.manha.sum / v.manha.n : null,
          tardeTma: v.tarde.n ? v.tarde.sum / v.tarde.n : null,
          manhaPct: total > 0 ? (v.manha.at / total) * 100 : 0,
        };
      })
      .filter((r) => r.total > 0)
      .sort((a, b) => b.total - a.total);
  }, [sgf, empMap]);

  const turnoTotals = useMemo(() => {
    const manhaAt = turnoRows.reduce((a, r) => a + r.manhaAt, 0);
    const tardeAt = turnoRows.reduce((a, r) => a + r.tardeAt, 0);
    return { manhaAt, tardeAt, total: manhaAt + tardeAt };
  }, [turnoRows]);

  const selectedEmp = empId ? empMap.get(empId) : null;

  // ---- Ociosidade ----
  const idleQ = useQuery({
    queryKey: ["desempenho-idle", start, end, empId],
    queryFn: async () => {
      return await fetchAllRows<IdleTicket>(() => {
        let q = supabase.from("sgf_tickets").select("employee_id,emitida_em,inicio_em,fim_em,estado,espera_s,atendimento_s")
          .gte("emitida_em", start + "T00:00:00").lte("emitida_em", end + "T23:59:59");
        if (empId) q = q.eq("employee_id", empId);
        return q;
      });
    },
  });
  const idleRows = useMemo(() => {
    const stats = computeIdle(idleQ.data ?? []);
    return Array.from(stats.values())
      .map((s) => ({ ...s, nome: empMap.get(s.employeeId)?.nome ?? "—" }))
      .filter((s) => empMap.has(s.employeeId))
      .sort((a, b) => b.idleTotalS - a.idleTotalS);
  }, [idleQ.data, empMap]);

  const scopeLabel = selectedEmp ? selectedEmp.nome : "Loja";

  // === % objetivo (Individual) ===
  const objetivoIndividual = useMemo(() => {
    if (!selectedEmp) return null;
    const obj = Number(selectedEmp.objetivo_mes ?? 0);
    if (obj <= 0) return null;
    return { objetivo: obj, atingido: kpis.pts, pct: (kpis.pts / obj) * 100 };
  }, [selectedEmp, kpis.pts]);

  const dEntrados = delta(kpis.entrados, kpisPrev.entrados);
  const dAtendidos = delta(kpis.atendidos, kpisPrev.atendidos);
  const dCancel = delta(kpis.cancelados, kpisPrev.cancelados);
  const dTma = delta(kpis.tma, kpisPrev.tma);
  const dPts = delta(kpis.pts, kpisPrev.pts);
  const dQty = delta(kpis.qty, kpisPrev.qty);
  const dTep = delta(kpis.tep, kpisPrev.tep);

  const toggleSort = (key: string) => {
    if (sortKey === key) setSearch({ dir: sortDir === "desc" ? "asc" : "desc" });
    else setSearch({ sort: key, dir: "desc" });
  };

  const exportDailyCSV = () => {
    const rows: (string | number)[][] = [["Dia", "Data", "Entrados", "Atendidos", "Cancelados", "% Atendimento"]];
    for (const r of perDay) {
      const pct = r.entrados > 0 ? (r.atendidos / r.entrados) * 100 : 0;
      rows.push([r.day, r.iso, r.entrados, r.atendidos, r.cancelados, r.entrados > 0 ? `${pct.toFixed(1)}%` : ""]);
    }
    rows.push(["Total", "", kpis.entrados, kpis.atendidos, kpis.cancelados, kpis.entrados > 0 ? `${((kpis.atendidos / kpis.entrados) * 100).toFixed(1)}%` : ""]);
    downloadCSV(`senhas_${year}_${String(month).padStart(2, "0")}.csv`, rows);
  };

  const exportLojistaCSV = () => {
    const rows: (string | number)[][] = [["#", "Colaborador", "Categoria", "Entrados", "Atendidos", "Cancelados", "TMA", "Unidades", "Ponderado", "Objetivo", "% Meta", "Fixo", "Móvel", "Marcações", "+Negócio", "NC", "%TEP"]];
    for (const r of lojistaRows) {
      rows.push([r.rank || "", r.e.nome, r.e.categoria ?? "", r.entrados, r.atendidos, r.cancelados, fmtSecsAsTime(r.tma), r.qty,
        Number(r.pts.toFixed(2)), Number(r.objetivo.toFixed(2)), r.objetivoPct !== null ? `${r.objetivoPct.toFixed(1)}%` : "",
        Number(r.catPts.fixo.toFixed(2)), Number(r.catPts.movel.toFixed(2)),
        Number(r.catPts.marcacoes.toFixed(2)), Number(r.catPts.negocio.toFixed(2)), Number(r.catPts.nc.toFixed(2)),
        r.atendidos > 0 ? `${r.tep.toFixed(1)}%` : ""]);
    }
    downloadCSV(`lojista_${year}_${String(month).padStart(2, "0")}.csv`, rows);
  };

  const copyResumo = async () => {
    const lines = [
      `Desempenho — ${scopeLabel} — ${MONTHS_PT[month - 1]} ${year}`,
      `Entrados: ${kpis.entrados} · Atendidos: ${kpis.atendidos} · Cancelados: ${kpis.cancelados} (${kpis.cancelRate.toFixed(1)}%)`,
      `TMA: ${fmtSecsAsTime(kpis.tma)} · TME: ${fmtSecsAsTime(kpis.tme)}`,
      `Ponderado: ${fmtNum(kpis.pts)} · Unidades: ${kpis.qty} · %TEP: ${kpis.tep.toFixed(1)}%`,
      "",
      ...tepPorCategoria.map((c) => `${c.label}: ${c.tep.toFixed(1)}% (alvo ${c.target}%)`),
    ];
    try {
      await navigator.clipboard.writeText(lines.join("\n"));
    } catch { /* noop */ }
  };

  const stickyRef = useRef<HTMLTableSectionElement>(null);

  return (
    <div>
      <PageHeader
        title="Desempenho"
        subtitle={`${scopeLabel} · ${MONTHS_PT[month - 1]} ${year}`}
        actions={
          <>
            <div className="inline-flex rounded-md border bg-card p-0.5 text-xs">
              <button
                onClick={() => setSearch({ emp: undefined })}
                className={classNames("inline-flex items-center gap-1 rounded px-2 py-1 font-semibold transition",
                  !empId ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-accent")}
              >
                <Users className="h-3.5 w-3.5" /> Loja
              </button>
              <button
                onClick={() => setSearch({ emp: employees[0]?.id ?? undefined })}
                className={classNames("inline-flex items-center gap-1 rounded px-2 py-1 font-semibold transition",
                  empId ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-accent")}
              >
                <User className="h-3.5 w-3.5" /> Individual
              </button>
            </div>
            {empId && (
              <select value={empId} onChange={(e) => setSearch({ emp: e.target.value })}
                className="rounded-md border bg-background px-2 py-1.5 text-sm">
                {employees.map((e) => <option key={e.id} value={e.id}>{e.nome}</option>)}
              </select>
            )}
            <select value={month} onChange={(e) => setSearch({ m: Number(e.target.value) })}
              className="rounded-md border bg-background px-2 py-1.5 text-sm">
              {MONTHS_PT.map((m, i) => <option key={i} value={i + 1}>{m}</option>)}
            </select>
            <select value={year} onChange={(e) => setSearch({ y: Number(e.target.value) })}
              className="rounded-md border bg-background px-2 py-1.5 text-sm">
              {[2024, 2025, 2026, 2027, 2028].map((y) => <option key={y} value={y}>{y}</option>)}
            </select>
            <label className="inline-flex items-center gap-1 text-xs text-muted-foreground cursor-pointer select-none">
              <input type="checkbox" checked={excludeFolgas} onChange={(e) => setSearch({ folgas: e.target.checked || undefined })} />
              Excluir folgas do TMA
            </label>
            <label
              className="inline-flex items-center gap-1 text-xs cursor-pointer select-none rounded-md border bg-card px-2 py-1 hover:bg-accent"
              title="Incluir/excluir NC (novos contratos) e Combina do total ponderado e %TEP"
            >
              <input
                type="checkbox"
                checked={includeNC}
                onChange={(e) => setSearch({ nc: e.target.checked ? undefined : false })}
              />
              <span className="font-semibold">Incluir NC + Combina</span>
            </label>

            <button onClick={copyResumo} className="inline-flex items-center gap-1 rounded-md border bg-card px-2 py-1.5 text-xs hover:bg-accent">
              <Copy className="h-3.5 w-3.5" /> Copiar resumo
            </button>
          </>
        }
      />

      <div className="p-2 md:p-4 max-w-[1400px] mx-auto space-y-3">
        {/* Objetivo individual (só quando selecionado) */}
        {objetivoIndividual && (
          <SectionCard title="Objetivo do mês" color="var(--neon-green)">
            <div className="p-3">
              <div className="flex items-baseline justify-between mb-2">
                <div className="flex items-baseline gap-2">
                  <Target className="h-4 w-4 text-[color:var(--success)]" />
                  <div className="text-3xl font-extrabold tabular-nums">{objetivoIndividual.pct.toFixed(0)}%</div>
                  <div className="text-xs text-muted-foreground">
                    {fmtNum(objetivoIndividual.atingido)} / {fmtNum(objetivoIndividual.objetivo)} pts
                  </div>
                </div>
                <div className={classNames(
                  "text-[10px] font-bold uppercase tracking-widest",
                  objetivoIndividual.pct >= 100 ? "text-[color:var(--success)]" : objetivoIndividual.pct >= 70 ? "text-[color:var(--neon-orange)]" : "text-destructive",
                )}>
                  {objetivoIndividual.pct >= 100 ? "Atingido" : objetivoIndividual.pct >= 70 ? "Em rota" : "Abaixo"}
                </div>
              </div>
              <div className="h-3 w-full rounded-full bg-muted overflow-hidden">
                <div className="h-full rounded-full transition-all"
                  style={{
                    width: `${Math.min(100, objetivoIndividual.pct)}%`,
                    background: objetivoIndividual.pct >= 100 ? "var(--success)" : objetivoIndividual.pct >= 70 ? "var(--neon-orange)" : "var(--destructive)",
                  }} />
              </div>
            </div>
          </SectionCard>
        )}

        {/* KPIs mensais com Δ e sparklines */}
        <SectionCard title={`Resumo mensal · vs ${MONTHS_PT[prev.m - 1]} ${prev.y}`} color="var(--neon-orange)">
          <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-8 gap-px bg-border">
            <KpiSpark icon={LogIn} label="Entrados" value={fmtNum(kpis.entrados, 0)} delta={dEntrados} data={sparkEntrados} color="var(--neon-blue)" />
            <KpiSpark icon={Ticket} label="Atendidos" value={fmtNum(kpis.atendidos, 0)} delta={dAtendidos} data={sparkAtendidos} color="var(--success)" />
            <KpiSpark icon={Ban} label="Cancelados" value={fmtNum(kpis.cancelados, 0)} delta={dCancel} invertDelta data={sparkCancel} color="var(--destructive)" />
            <Kpi icon={AlertTriangle} label="% Cancel." value={`${kpis.cancelRate.toFixed(1)}%`} tone={kpis.cancelRate > 15 ? "bad" : kpis.cancelRate > 8 ? "warn" : "ok"} />
            <Kpi icon={Timer} label="TMA" value={fmtSecsAsTime(kpis.tma)} delta={dTma} invertDelta tone={kpis.tma > TMA_ALERT_S ? "warn" : undefined} />
            <Kpi icon={Clock} label="TME" value={fmtSecsAsTime(kpis.tme)} />
            <Kpi icon={TrendingUp} label="Ponderado" value={fmtNum(kpis.pts)} delta={dPts} />
            <Kpi icon={Package} label="Unidades" value={fmtNum(kpis.qty, 0)} delta={dQty} />
          </div>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-px bg-border border-t">
            <Kpi icon={TrendingUp} label="%TEP" value={`${kpis.tep.toFixed(0)}%`} delta={dTep} />
            <Kpi icon={Calendar} label="Horas escaladas" value={fmtNum(horasEscaladas, 1)} />
            <Kpi
              icon={Users}
              label="Atendidos / hora"
              value={horasEscaladas > 0 ? fmtNum(kpis.atendidos / horasEscaladas, 2) : "—"}
            />
          </div>
        </SectionCard>

        {/* TEP por categoria com barra + semáforo */}
        <SectionCard title="TEP por categoria" color="var(--neon-violet)">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-2 p-2">
            {tepPorCategoria.map((c) => {
              const pctBar = Math.min(100, (c.tep / Math.max(c.target * 1.5, 1)) * 100);
              const tone = c.semaforo === "ok" ? "var(--success)" : c.semaforo === "warn" ? "var(--neon-orange)" : "var(--destructive)";
              return (
                <div key={c.key} className="rounded-lg border p-2"
                  style={{
                    borderColor: `color-mix(in oklab, ${c.color} 40%, transparent)`,
                    background: `color-mix(in oklab, ${c.color} 6%, var(--card))`,
                  }}>
                  <div className="flex items-baseline justify-between">
                    <div className="text-[10px] font-bold uppercase tracking-wider" style={{ color: c.color }}>{c.label}</div>
                    <div className="text-[10px] text-muted-foreground tabular-nums">alvo {c.target}%</div>
                  </div>
                  <div className="mt-0.5 flex items-baseline gap-2">
                    <div className="text-2xl font-extrabold tabular-nums leading-none">{c.tep.toFixed(0)}%</div>
                    <span className="inline-block h-2 w-2 rounded-full" style={{ background: tone }} />
                  </div>
                  <div className="mt-1.5 h-1.5 w-full rounded-full bg-muted overflow-hidden">
                    <div className="h-full rounded-full" style={{ width: `${pctBar}%`, background: tone }} />
                  </div>
                  <div className="mt-1 text-[10px] text-muted-foreground tabular-nums">{fmtNum(c.pts)} pts · {fmtNum(c.qty, 0)} un</div>
                </div>
              );
            })}
          </div>
          <div className="border-t px-3 py-1.5 text-[10px] text-muted-foreground">
            %TEP = pontos / atendidos × 100 (base: {fmtNum(kpis.atendidos, 0)} atendidos)
          </div>
        </SectionCard>

        {/* Melhor / pior dia */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <BestWorstCard title="Melhor dia" tone="ok" day={bestDay} year={year} month={month} icon={Trophy} />
          <BestWorstCard title="Pior atendimento" tone="bad" day={worstDay} year={year} month={month} icon={AlertTriangle} />
        </div>

        {/* Tendência 6 meses */}
        <SectionCard title={`Tendência · últimos 6 meses (até ${MONTHS_PT[month - 1]} ${year})`} color="var(--neon-violet)">
          <div className="p-2" style={{ height: 260 }}>
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={trendData} margin={{ top: 5, right: 8, left: -20, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                <XAxis dataKey="label" tick={{ fontSize: 10 }} stroke="hsl(var(--muted-foreground))" />
                <YAxis yAxisId="left" tick={{ fontSize: 10 }} stroke="hsl(var(--muted-foreground))" />
                <YAxis yAxisId="right" orientation="right" tick={{ fontSize: 10 }} stroke="hsl(var(--muted-foreground))" unit="%" />
                <Tooltip contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", fontSize: 12 }} />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                <Line yAxisId="left" type="monotone" dataKey="atendidos" stroke="var(--success)" strokeWidth={2} dot={{ r: 3 }} name="Atendidos" />
                <Line yAxisId="left" type="monotone" dataKey="pts" stroke="var(--neon-orange)" strokeWidth={2} dot={{ r: 3 }} name="Ponderado" />
                <Line yAxisId="right" type="monotone" dataKey="tep" stroke="var(--neon-blue)" strokeWidth={2} dot={{ r: 3 }} name="%TEP" />
                <Line yAxisId="right" type="monotone" dataKey="cancelRate" stroke="var(--destructive)" strokeWidth={1.5} strokeDasharray="4 4" dot={{ r: 2 }} name="% Cancel." />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </SectionCard>

        {/* Mix + Heatmap dow×hora lado-a-lado */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
          <SectionCard title="Mix de vendas — pontos por categoria" color="var(--neon-pink)">
            <div className="p-2 grid grid-cols-1 md:grid-cols-2 items-center gap-2" style={{ minHeight: 240 }}>
              <div style={{ height: 220 }}>
                {mixCategorias.length === 0 ? (
                  <div className="flex h-full items-center justify-center text-muted-foreground text-sm">
                    <PieIcon className="h-4 w-4 mr-1" /> Sem vendas
                  </div>
                ) : (
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie data={mixCategorias} dataKey="value" nameKey="name" cx="50%" cy="50%" innerRadius={45} outerRadius={80} paddingAngle={2}>
                        {mixCategorias.map((c, i) => <Cell key={i} fill={c.color} />)}
                      </Pie>
                      <Tooltip contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", fontSize: 12 }}
                        formatter={(v: number) => `${fmtNum(v)} pts (${mixTotal > 0 ? ((v / mixTotal) * 100).toFixed(0) : 0}%)`} />
                    </PieChart>
                  </ResponsiveContainer>
                )}
              </div>
              <ul className="space-y-1 text-xs">
                {mixCategorias.map((c) => {
                  const pct = mixTotal > 0 ? (c.value / mixTotal) * 100 : 0;
                  return (
                    <li key={c.name} className="flex items-center justify-between gap-2">
                      <span className="inline-flex items-center gap-1.5 truncate">
                        <span className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: c.color }} />
                        <span className="font-semibold" style={{ color: c.color }}>{c.name}</span>
                      </span>
                      <span className="tabular-nums text-muted-foreground">
                        {pct.toFixed(0)}% <span className="opacity-60">· {fmtNum(c.value)} pts</span>
                      </span>
                    </li>
                  );
                })}
                {mixCategorias.length === 0 && <li className="text-muted-foreground">Sem dados.</li>}
              </ul>
            </div>
          </SectionCard>

          <SectionCard title="Horas-pico · dia da semana × hora" color="var(--neon-blue)">
            <div className="overflow-x-auto p-2">
              <table className="text-[10px] tabular-nums">
                <thead>
                  <tr>
                    <th className="px-1 py-0.5 text-left text-muted-foreground font-semibold"></th>
                    {dowHour.hours.map((h) => (
                      <th key={h} className="px-1 py-0.5 text-center text-muted-foreground font-semibold w-6">{h}h</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"].map((label, dow) => (
                    <tr key={dow}>
                      <td className="px-1 py-0.5 font-semibold text-muted-foreground">{label}</td>
                      {dowHour.hours.map((h) => {
                        const v = dowHour.grid[dow][h];
                        const intensity = dowHour.max > 0 ? v / dowHour.max : 0;
                        return (
                          <td key={h} className="text-center"
                            style={{
                              background: v === 0 ? "transparent" : `color-mix(in oklab, var(--neon-blue) ${Math.max(6, intensity * 70)}%, transparent)`,
                              color: intensity > 0.5 ? "white" : undefined,
                              minWidth: 22,
                              height: 22,
                              border: "1px solid color-mix(in oklab, var(--border) 60%, transparent)",
                              fontWeight: intensity > 0.6 ? 700 : 500,
                            }}
                            title={`${label} ${h}h: ${v} senha${v === 1 ? "" : "s"}`}>
                            {v > 0 ? v : ""}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
              <div className="mt-1.5 text-[10px] text-muted-foreground">Total senhas do mês por hora e dia — mais escuro = mais movimento.</div>
            </div>
          </SectionCard>
        </div>

        {/* Turnos: manhã vs tarde */}
        <SectionCard title={`Turnos · manhã (<${TURNO_SPLIT_HOUR}h) vs tarde`} color="var(--neon-violet)">
          {turnoRows.length === 0 ? (
            <p className="p-3 text-sm text-muted-foreground">Sem senhas no período.</p>
          ) : (
            <>
              <div className="grid grid-cols-2 gap-px border-b bg-border">
                <div className="bg-card p-2">
                  <div className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Atendidos manhã</div>
                  <div className="text-lg font-bold tabular-nums">{fmtNum(turnoTotals.manhaAt, 0)}</div>
                  <div className="text-[10px] text-muted-foreground">
                    {turnoTotals.total > 0 ? `${((turnoTotals.manhaAt / turnoTotals.total) * 100).toFixed(0)}% do total` : "—"}
                  </div>
                </div>
                <div className="bg-card p-2">
                  <div className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Atendidos tarde</div>
                  <div className="text-lg font-bold tabular-nums">{fmtNum(turnoTotals.tardeAt, 0)}</div>
                  <div className="text-[10px] text-muted-foreground">
                    {turnoTotals.total > 0 ? `${((turnoTotals.tardeAt / turnoTotals.total) * 100).toFixed(0)}% do total` : "—"}
                  </div>
                </div>
              </div>
              <div className="overflow-x-auto max-h-[60vh]">
                <table className="w-full min-w-max text-sm">
                  <thead className="sticky top-0 z-10 bg-muted/70 backdrop-blur">
                    <tr className="border-b text-[11px] uppercase tracking-wider text-muted-foreground">
                      <th className="px-2 py-1.5 text-left">Colaborador</th>
                      <th className="px-2 py-1.5 text-right">Manhã</th>
                      <th className="px-2 py-1.5 text-right">TMA manhã</th>
                      <th className="px-2 py-1.5 text-right">Tarde</th>
                      <th className="px-2 py-1.5 text-right">TMA tarde</th>
                      <th className="px-2 py-1.5 text-left w-40">Distribuição</th>
                      <th className="px-2 py-1.5 text-right">Rende mais</th>
                    </tr>
                  </thead>
                  <tbody>
                    {turnoRows.map((r) => {
                      const melhor = r.manhaAt === r.tardeAt ? "—" : r.manhaAt > r.tardeAt ? "Manhã" : "Tarde";
                      return (
                        <tr key={r.id} className="border-b last:border-0">
                          <td className="px-2 py-1 font-semibold">
                            {r.slug ? (
                              <Link to="/individual/$slug" params={{ slug: r.slug }} className="text-primary hover:underline">{r.nome}</Link>
                            ) : r.nome}
                          </td>
                          <td className="px-2 py-1 text-right tabular-nums">{fmtNum(r.manhaAt, 0)}</td>
                          <td className="px-2 py-1 text-right tabular-nums text-muted-foreground">{r.manhaTma != null ? fmtSecsAsTime(r.manhaTma) : "—"}</td>
                          <td className="px-2 py-1 text-right tabular-nums">{fmtNum(r.tardeAt, 0)}</td>
                          <td className="px-2 py-1 text-right tabular-nums text-muted-foreground">{r.tardeTma != null ? fmtSecsAsTime(r.tardeTma) : "—"}</td>
                          <td className="px-2 py-1">
                            <div className="flex h-2 w-full overflow-hidden rounded-full bg-muted" title={`Manhã ${r.manhaPct.toFixed(0)}% · Tarde ${(100 - r.manhaPct).toFixed(0)}%`}>
                              <div style={{ width: `${r.manhaPct}%`, background: "var(--neon-yellow)" }} />
                              <div style={{ width: `${100 - r.manhaPct}%`, background: "var(--neon-violet)" }} />
                            </div>
                          </td>
                          <td className="px-2 py-1 text-right text-[11px] font-bold"
                            style={{ color: melhor === "Manhã" ? "var(--neon-yellow)" : melhor === "Tarde" ? "var(--neon-violet)" : undefined }}>
                            {melhor}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              <div className="border-t p-2 text-[10px] leading-relaxed text-muted-foreground">
                <b>Manhã</b> = senhas emitidas antes das {TURNO_SPLIT_HOUR}h; <b>Tarde</b> = a partir das {TURNO_SPLIT_HOUR}h.
                <b> Manhã/Tarde</b> = senhas atendidas em cada período. <b>TMA</b> = tempo médio de atendimento nesse período.
                <b> Rende mais</b> = período com mais atendimentos.
              </div>
            </>
          )}
        </SectionCard>

        {/* Gráfico dia-a-dia */}
        <SectionCard
          title="Senhas — dia a dia"
          color="var(--neon-blue)"
          right={
            <button onClick={exportDailyCSV} className="inline-flex items-center gap-1 rounded border border-black/25 bg-black/10 px-1.5 py-0.5 text-[10px] font-semibold hover:bg-black/20">
              <Download className="h-3 w-3" /> CSV
            </button>
          }
        >
          <div className="p-2" style={{ height: 240 }}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={perDay} margin={{ top: 5, right: 8, left: -20, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                <XAxis dataKey="day" tick={{ fontSize: 10 }} stroke="hsl(var(--muted-foreground))" />
                <YAxis tick={{ fontSize: 10 }} stroke="hsl(var(--muted-foreground))" />
                <Tooltip contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", fontSize: 12 }} />
                <Bar dataKey="entrados" fill="var(--neon-blue)" name="Entrados" radius={[2, 2, 0, 0]} />
                <Bar dataKey="atendidos" fill="var(--success)" name="Atendidos" radius={[2, 2, 0, 0]} />
                <Bar dataKey="cancelados" fill="var(--destructive)" name="Cancelados" radius={[2, 2, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
          <div className="overflow-x-auto border-t">
            <table className="w-full min-w-max text-sm">
              <thead className="sticky top-0 bg-muted/70 backdrop-blur">
                <tr className="border-b text-[11px] uppercase tracking-wider text-muted-foreground">
                  <th className="px-2 py-1.5 text-left">Dia</th>
                  <th className="px-2 py-1.5 text-right">Entrados</th>
                  <th className="px-2 py-1.5 text-right">Atendidos</th>
                  <th className="px-2 py-1.5 text-right">Cancelados</th>
                  <th className="px-2 py-1.5 text-right">% Atend.</th>
                </tr>
              </thead>
              <tbody>
                {perDay.map((r) => {
                  const pct = r.entrados > 0 ? (r.atendidos / r.entrados) * 100 : 0;
                  const isEmpty = r.entrados === 0;
                  const alert = !isEmpty && pct < ATT_ALERT_PCT;
                  return (
                    <tr key={r.iso} className={classNames("border-b last:border-0", isEmpty ? "opacity-40" : "hover:bg-accent/20", alert && "bg-destructive/5")}>
                      <td className="px-2 py-1 font-semibold tabular-nums">
                        {isEmpty ? (
                          <span>{String(r.day).padStart(2, "0")}</span>
                        ) : (
                          <Link to="/pds" search={{ data: r.iso } as never} className="text-primary hover:underline">
                            {String(r.day).padStart(2, "0")}
                          </Link>
                        )}
                      </td>
                      <td className="px-2 py-1 text-right tabular-nums">{fmtNum(r.entrados, 0)}</td>
                      <td className="px-2 py-1 text-right tabular-nums text-[color:var(--success)]">{fmtNum(r.atendidos, 0)}</td>
                      <td className="px-2 py-1 text-right tabular-nums text-destructive">{fmtNum(r.cancelados, 0)}</td>
                      <td className={classNames("px-2 py-1 text-right tabular-nums", alert && "font-bold text-destructive")}>
                        {isEmpty ? "—" : `${pct.toFixed(0)}%`}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot>
                <tr className="border-t bg-muted/40 font-bold">
                  <td className="px-2 py-1.5">Total</td>
                  <td className="px-2 py-1.5 text-right tabular-nums">{fmtNum(kpis.entrados, 0)}</td>
                  <td className="px-2 py-1.5 text-right tabular-nums text-[color:var(--success)]">{fmtNum(kpis.atendidos, 0)}</td>
                  <td className="px-2 py-1.5 text-right tabular-nums text-destructive">{fmtNum(kpis.cancelados, 0)}</td>
                  <td className="px-2 py-1.5 text-right tabular-nums">
                    {kpis.entrados > 0 ? `${((kpis.atendidos / kpis.entrados) * 100).toFixed(0)}%` : "—"}
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
        </SectionCard>

        {/* Heatmap colaborador × categoria (só Loja) */}
        {!empId && lojistaRows.length > 0 && (
          <SectionCard title="Heatmap colaborador × categoria" color="var(--neon-pink)">
            <div className="overflow-x-auto">
              <table className="w-full min-w-max text-sm">
                <thead>
                  <tr className="border-b bg-muted/50 text-[11px] uppercase tracking-wider text-muted-foreground">
                    <th className="px-2 py-1.5 text-left sticky left-0 bg-muted/70">Colaborador</th>
                    {(Object.keys(CAT_META) as CatKey[]).map((k) => (
                      <th key={k} className="px-2 py-1.5 text-right" style={{ color: CAT_META[k].color }}>{CAT_META[k].label}</th>
                    ))}
                    <th className="px-2 py-1.5 text-right">%TEP</th>
                  </tr>
                </thead>
                <tbody>
                  {lojistaRows.map((r) => (
                    <tr key={r.e.id} className="border-b last:border-0">
                      <td className="px-2 py-1 font-semibold sticky left-0 bg-card">
                        <Link to="/individual/$slug" params={{ slug: r.e.slug }} className="text-primary hover:underline">{r.e.nome}</Link>
                      </td>
                      {(Object.keys(CAT_META) as CatKey[]).map((k) => {
                        const v = r.catPts[k];
                        const cellTep = r.atendidos > 0 ? (v / r.atendidos) * 100 : 0;
                        const intensity = Math.min(1, cellTep / (TEP_TARGET[k] * 1.5));
                        return (
                          <td key={k} className="px-2 py-1 text-right tabular-nums"
                            style={{ background: `color-mix(in oklab, ${CAT_META[k].color} ${intensity * 55}%, transparent)` }}>
                            {cellTep.toFixed(0)}%
                          </td>
                        );
                      })}
                      <td className="px-2 py-1 text-right tabular-nums font-bold">{r.atendidos > 0 ? `${r.tep.toFixed(0)}%` : "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </SectionCard>
        )}

        {/* Lojista mensal (só Loja) */}
        {!empId && (
          <SectionCard
            title="Lojista mensal"
            color="var(--neon-green)"
            right={
              <div className="flex items-center gap-1">
                {empCategorias.length > 0 && (
                  <select
                    value={catFilter}
                    onChange={(e) => setSearch({ cat: e.target.value || undefined })}
                    className="rounded border border-black/25 bg-black/10 px-1.5 py-0.5 text-[10px] font-semibold"
                  >
                    <option value="">Todas categorias</option>
                    {empCategorias.map((c) => <option key={c} value={c}>{c}</option>)}
                  </select>
                )}
                <button onClick={exportLojistaCSV} className="inline-flex items-center gap-1 rounded border border-black/25 bg-black/10 px-1.5 py-0.5 text-[10px] font-semibold hover:bg-black/20">
                  <Download className="h-3 w-3" /> CSV
                </button>
              </div>
            }
          >
            <div className="overflow-x-auto max-h-[70vh]">
              <table className="w-full min-w-max text-sm">
                <thead ref={stickyRef} className="sticky top-0 z-10 bg-muted/70 backdrop-blur">
                  <tr className="border-b text-[11px] uppercase tracking-wider text-muted-foreground">
                    <th className="px-2 py-1.5 text-left w-10">#</th>
                    <SortableTh k="nome" label="Colaborador" sortKey={sortKey} sortDir={sortDir} onClick={toggleSort} align="left" />
                    <SortableTh k="entrados" label="Entrados" sortKey={sortKey} sortDir={sortDir} onClick={toggleSort} />
                    <SortableTh k="atendidos" label="Atendidos" sortKey={sortKey} sortDir={sortDir} onClick={toggleSort} />
                    <SortableTh k="cancelados" label="Cancel." sortKey={sortKey} sortDir={sortDir} onClick={toggleSort} />
                    <SortableTh k="tma" label="TMA" sortKey={sortKey} sortDir={sortDir} onClick={toggleSort} />
                    <SortableTh k="qty" label="Un" sortKey={sortKey} sortDir={sortDir} onClick={toggleSort} />
                    <SortableTh k="pts" label="Pond" sortKey={sortKey} sortDir={sortDir} onClick={toggleSort} />
                    <SortableTh k="objetivo" label="% Meta" sortKey={sortKey} sortDir={sortDir} onClick={toggleSort} />
                    <SortableTh k="fixo" label="Fixo" sortKey={sortKey} sortDir={sortDir} onClick={toggleSort} />
                    <SortableTh k="movel" label="Móvel" sortKey={sortKey} sortDir={sortDir} onClick={toggleSort} />
                    <SortableTh k="marcacoes" label="Marc." sortKey={sortKey} sortDir={sortDir} onClick={toggleSort} />
                    <SortableTh k="negocio" label="+Neg." sortKey={sortKey} sortDir={sortDir} onClick={toggleSort} />
                    <SortableTh k="nc" label="NC" sortKey={sortKey} sortDir={sortDir} onClick={toggleSort} />
                    <SortableTh k="tep" label="%TEP" sortKey={sortKey} sortDir={sortDir} onClick={toggleSort} />
                  </tr>
                </thead>
                <tbody>
                  {lojistaRows.map((r) => {
                    const attPct = r.entrados > 0 ? (r.atendidos / r.entrados) * 100 : 0;
                    const alert = (r.entrados > 0 && attPct < ATT_ALERT_PCT) || (r.atendidos > 0 && r.tma > TMA_ALERT_S);
                    const medal = r.rank === 1 ? "🥇" : r.rank === 2 ? "🥈" : r.rank === 3 ? "🥉" : null;
                    return (
                      <tr key={r.e.id} className={classNames("border-b last:border-0 hover:bg-accent/20", alert && "bg-destructive/5")}>
                        <td className="px-2 py-1 tabular-nums">
                          <div className="flex items-center gap-1">
                            {medal ? <span className="text-base leading-none">{medal}</span> : <span className="text-muted-foreground font-semibold">{r.rank || "—"}</span>}
                            {r.deltaRank !== null && r.deltaRank !== 0 && (
                              <span className={classNames(
                                "text-[9px] font-bold tabular-nums",
                                r.deltaRank > 0 ? "text-[color:var(--success)]" : "text-destructive",
                              )}>
                                {r.deltaRank > 0 ? `▲${r.deltaRank}` : `▼${Math.abs(r.deltaRank)}`}
                              </span>
                            )}
                          </div>
                        </td>
                        <td className="px-2 py-1 font-semibold truncate max-w-40">
                          <Link to="/individual/$slug" params={{ slug: r.e.slug }} className="text-primary hover:underline">{r.e.nome}</Link>
                          {r.e.categoria && <span className="ml-1 text-[9px] font-normal text-muted-foreground">· {r.e.categoria}</span>}
                        </td>
                        <td className="px-2 py-1 text-right tabular-nums">{fmtNum(r.entrados, 0)}</td>
                        <td className="px-2 py-1 text-right tabular-nums text-[color:var(--success)]">{fmtNum(r.atendidos, 0)}</td>
                        <td className="px-2 py-1 text-right tabular-nums text-destructive">{fmtNum(r.cancelados, 0)}</td>
                        <td className={classNames("px-2 py-1 text-right tabular-nums", r.atendidos > 0 && r.tma > TMA_ALERT_S && "text-destructive font-bold")}>
                          {r.atendidos > 0 ? fmtSecsAsTime(r.tma) : "—"}
                        </td>
                        <td className="px-2 py-1 text-right tabular-nums">{fmtNum(r.qty, 0)}</td>
                        <td className="px-2 py-1 text-right tabular-nums font-semibold">{fmtNum(r.pts)}</td>
                        <td className="px-2 py-1 tabular-nums" style={{ minWidth: 100 }}>
                          {r.objetivoPct === null ? (
                            <span className="text-muted-foreground text-[10px]">—</span>
                          ) : (
                            <div className="flex items-center gap-1.5">
                              <div className="h-1.5 flex-1 rounded-full bg-muted overflow-hidden">
                                <div className="h-full rounded-full"
                                  style={{
                                    width: `${Math.min(100, r.objetivoPct)}%`,
                                    background: r.objetivoPct >= 100 ? "var(--success)" : r.objetivoPct >= 70 ? "var(--neon-orange)" : "var(--destructive)",
                                  }} />
                              </div>
                              <span className={classNames(
                                "text-[10px] font-bold tabular-nums w-9 text-right",
                                r.objetivoPct >= 100 ? "text-[color:var(--success)]" : r.objetivoPct >= 70 ? "text-[color:var(--neon-orange)]" : "text-destructive",
                              )}>{r.objetivoPct.toFixed(0)}%</span>
                            </div>
                          )}
                        </td>
                        <td className="px-2 py-1 text-right tabular-nums">{fmtNum(r.catPts.fixo)}</td>
                        <td className="px-2 py-1 text-right tabular-nums">{fmtNum(r.catPts.movel)}</td>
                        <td className="px-2 py-1 text-right tabular-nums">{fmtNum(r.catPts.marcacoes)}</td>
                        <td className="px-2 py-1 text-right tabular-nums">{fmtNum(r.catPts.negocio)}</td>
                        <td className="px-2 py-1 text-right tabular-nums">{fmtNum(r.catPts.nc)}</td>
                        <td className="px-2 py-1 text-right tabular-nums font-bold">{r.atendidos > 0 ? `${r.tep.toFixed(0)}%` : "—"}</td>
                      </tr>
                    );
                  })}
                  {lojistaRows.length === 0 && (
                    <tr><td colSpan={15} className="px-3 py-6 text-center text-muted-foreground">Sem dados no mês.</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </SectionCard>
        )}

        {/* Ociosidade — tempo morto entre atendimentos */}
        <SectionCard title="Ociosidade (tempo morto entre atendimentos)" color="var(--neon-yellow)"
          right={
            <button
              type="button"
              onClick={() => exportCsv(`ociosidade-${year}-${String(month).padStart(2, "0")}`, idleRows.map((r) => ({
                Colaborador: r.nome,
                Atendimentos: r.atendimentos,
                "Tempo morto total": fmtDur(r.idleTotalS),
                "Média entre atendimentos": fmtDur(r.idleAvgS),
                "Maior intervalo": fmtDur(r.idleMaxS),
                Manhã: fmtDur(r.manhaS),
                Tarde: fmtDur(r.tardeS),
              })))}
              disabled={idleRows.length === 0}
              className="inline-flex items-center gap-1 rounded border border-black/25 bg-black/10 px-1.5 py-0.5 text-[10px] font-semibold disabled:opacity-40"
            >
              <Download className="h-3 w-3" /> CSV
            </button>
          }
        >
          <div className="px-3 py-2 text-[11px] text-muted-foreground">
            Intervalos entre o fim de um atendimento e o início do seguinte, no mesmo dia.
            Pausas acima de {IDLE_MAX_GAP_MIN} min (almoço/formação) são ignoradas.
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="bg-muted/50 text-muted-foreground">
                <tr>
                  <th className="px-2 py-1.5 text-left">Colaborador</th>
                  <th className="px-2 py-1.5 text-right">Atend.</th>
                  <th className="px-2 py-1.5 text-right">Tempo morto</th>
                  <th className="px-2 py-1.5 text-right">Média</th>
                  <th className="px-2 py-1.5 text-right">Maior</th>
                  <th className="px-2 py-1.5 text-right">Manhã</th>
                  <th className="px-2 py-1.5 text-right">Tarde</th>
                </tr>
              </thead>
              <tbody>
                {idleRows.map((r) => (
                  <tr key={r.employeeId} className="border-t">
                    <td className="px-2 py-1 font-medium">{r.nome}</td>
                    <td className="px-2 py-1 text-right tabular-nums">{r.atendimentos}</td>
                    <td className="px-2 py-1 text-right tabular-nums font-bold">{fmtDur(r.idleTotalS)}</td>
                    <td className="px-2 py-1 text-right tabular-nums"
                      style={{ color: r.idleAvgS > IDLE_ALERT_MIN * 60 ? "var(--destructive)" : undefined }}>
                      {fmtDur(r.idleAvgS)}
                    </td>
                    <td className="px-2 py-1 text-right tabular-nums">{fmtDur(r.idleMaxS)}</td>
                    <td className="px-2 py-1 text-right tabular-nums">{fmtDur(r.manhaS)}</td>
                    <td className="px-2 py-1 text-right tabular-nums">{fmtDur(r.tardeS)}</td>
                  </tr>
                ))}
                {idleRows.length === 0 && (
                  <tr><td colSpan={7} className="px-3 py-6 text-center text-muted-foreground">Sem senhas terminadas no período.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </SectionCard>
      </div>

    </div>
  );
}

function SectionCard({
  title, color, right, children,
}: { title: string; color: string; right?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="overflow-hidden rounded-lg border bg-card shadow-sm"
      style={{
        borderColor: `color-mix(in oklab, ${color} 45%, transparent)`,
        boxShadow: `0 0 0 1px color-mix(in oklab, ${color} 20%, transparent)`,
      }}>
      <header className="flex items-center justify-between gap-2 px-2.5 py-1 text-white"
        style={{ background: `linear-gradient(90deg, ${color}, color-mix(in oklab, ${color} 55%, black))` }}>
        <h2 className="text-[10px] font-bold uppercase tracking-widest text-black/85 [text-shadow:0_0_6px_rgba(255,255,255,0.4)]">{title}</h2>
        {right && <span className="text-[10px] text-black/80 tabular-nums font-semibold">{right}</span>}
      </header>
      {children}
    </section>
  );
}

function DeltaBadge({ delta, invert }: { delta: number | null; invert?: boolean }) {
  if (delta === null || !isFinite(delta)) return null;
  const positive = delta >= 0;
  const good = invert ? !positive : positive;
  const Icon = positive ? TrendingUp : TrendingDown;
  return (
    <span className={classNames(
      "inline-flex items-center gap-0.5 rounded px-1 text-[9px] font-bold tabular-nums",
      good ? "bg-[color:var(--success)]/15 text-[color:var(--success)]" : "bg-destructive/15 text-destructive",
    )}>
      <Icon className="h-2.5 w-2.5" />{positive ? "+" : ""}{delta.toFixed(0)}%
    </span>
  );
}

function Kpi({
  icon: Icon, label, value, delta, invertDelta, tone,
}: {
  icon: typeof TrendingUp; label: string; value: string;
  delta?: number | null; invertDelta?: boolean; tone?: "ok" | "warn" | "bad";
}) {
  const toneBg = tone === "bad" ? "bg-destructive/10" : tone === "warn" ? "bg-[color:var(--neon-orange)]/10" : tone === "ok" ? "bg-[color:var(--success)]/10" : "bg-card";
  return (
    <div className={classNames("px-2 py-2 text-center", toneBg)}>
      <div className="flex items-center justify-center gap-1 text-[9px] font-medium uppercase tracking-wider text-muted-foreground leading-tight">
        <Icon className="h-3 w-3" />{label}
      </div>
      <div className="mt-0.5 flex items-center justify-center gap-1">
        <div className="tabular-nums font-bold leading-tight text-lg">{value}</div>
      </div>
      {delta !== undefined && <div className="mt-0.5"><DeltaBadge delta={delta ?? null} invert={invertDelta} /></div>}
    </div>
  );
}

function KpiSpark({
  icon: Icon, label, value, delta, invertDelta, data, color,
}: {
  icon: typeof TrendingUp; label: string; value: string;
  delta: number | null; invertDelta?: boolean;
  data: { x: number; y: number }[]; color: string;
}) {
  return (
    <div className="bg-card px-2 py-2 text-center">
      <div className="flex items-center justify-center gap-1 text-[9px] font-medium uppercase tracking-wider text-muted-foreground leading-tight">
        <Icon className="h-3 w-3" />{label}
      </div>
      <div className="mt-0.5 tabular-nums font-bold leading-tight text-lg">{value}</div>
      <div style={{ height: 22 }}>
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data} margin={{ top: 2, right: 2, left: 2, bottom: 0 }}>
            <Line type="monotone" dataKey="y" stroke={color} strokeWidth={1.5} dot={false} isAnimationActive={false} />
          </LineChart>
        </ResponsiveContainer>
      </div>
      <div className="mt-0.5"><DeltaBadge delta={delta} invert={invertDelta} /></div>
    </div>
  );
}

function BestWorstCard({
  title, tone, day, year, month, icon: Icon,
}: {
  title: string; tone: "ok" | "bad";
  day: { day: number; iso: string; entrados: number; atendidos: number; cancelados: number } | null;
  year: number; month: number; icon: typeof Trophy;
}) {
  const color = tone === "ok" ? "var(--success)" : "var(--destructive)";
  if (!day) {
    return (
      <div className="rounded-lg border p-3 text-center text-muted-foreground text-sm bg-card">
        {title}: sem dados
      </div>
    );
  }
  const pct = day.entrados > 0 ? (day.atendidos / day.entrados) * 100 : 0;
  return (
    <Link to="/pds" search={{ data: day.iso } as never}
      className="block rounded-lg border p-3 bg-card hover:bg-accent/20 transition"
      style={{ borderColor: `color-mix(in oklab, ${color} 40%, transparent)` }}>
      <div className="flex items-center justify-between">
        <div className="text-[10px] font-bold uppercase tracking-widest" style={{ color }}>
          <Icon className="inline h-3 w-3 mr-1" />{title}
        </div>
        <div className="text-[10px] text-muted-foreground tabular-nums">{day.iso}</div>
      </div>
      <div className="mt-1 flex items-baseline gap-3">
        <div className="text-3xl font-extrabold tabular-nums leading-none">{String(day.day).padStart(2, "0")}</div>
        <div className="text-xs text-muted-foreground tabular-nums">
          {MONTHS_PT[month - 1]} {year} · {day.atendidos}/{day.entrados} atendidos ({pct.toFixed(0)}%)
        </div>
      </div>
    </Link>
  );
}

function SortableTh({
  k, label, sortKey, sortDir, onClick, align = "right",
}: {
  k: string; label: string; sortKey: string; sortDir: string;
  onClick: (k: string) => void; align?: "left" | "right";
}) {
  const active = sortKey === k;
  return (
    <th className={classNames("px-2 py-1.5 select-none cursor-pointer", align === "right" ? "text-right" : "text-left")}
      onClick={() => onClick(k)}>
      <span className={classNames("inline-flex items-center gap-0.5", active && "text-foreground")}>
        {label}
        <ArrowUpDown className={classNames("h-3 w-3", active ? "opacity-100" : "opacity-40")} />
        {active && <span className="text-[9px]">{sortDir === "desc" ? "▼" : "▲"}</span>}
      </span>
    </th>
  );
}
