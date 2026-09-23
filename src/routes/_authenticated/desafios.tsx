import { createFileRoute } from "@tanstack/react-router";
import { RouteError, RouteNotFound, pageHead } from "@/components/RouteBoundary";
import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/AppShell";
import { fmtNum, ymd, classNames } from "@/lib/domain";
import { computeProgress, METRIC_LABELS, REDUCTION_METRICS, type Metric } from "@/lib/challenges";
import { Trophy, Plus, Trash2, Pencil, Target, CalendarDays, Users2, Check, X } from "lucide-react";
import { toast } from "sonner";
import { useConfirm } from "@/components/ConfirmDialog";

export const Route = createFileRoute("/_authenticated/desafios")({
  head: pageHead("Desafios · PDS LoureShopping", "Desafios ativos, metas e ranking por colaborador."),
  errorComponent: ({ error, reset }) => <RouteError error={error} reset={reset} />,
  notFoundComponent: () => <RouteNotFound />,
  component: DesafiosPage,
});

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

type Emp = { id: string; nome: string; slug: string };

function todayIso() { return ymd(new Date()); }

function DesafiosPage() {
  const qc = useQueryClient();
  const { confirm, dialog: confirmDialog } = useConfirm();
  const [editing, setEditing] = useState<Partial<Challenge> | null>(null);

  async function deleteChallenge(c: Challenge) {
    if (!(await confirm({
      title: `Apagar "${c.titulo}"?`,
      description: "O desafio será removido permanentemente.",
      confirmLabel: "Apagar",
      destructive: true,
    }))) return;
    const { error } = await supabase.from("challenges").delete().eq("id", c.id);
    if (error) toast.error(error.message);
    else { toast.success("Apagado"); qc.invalidateQueries({ queryKey: ["challenges"] }); }
  }


  const chQ = useQuery({
    queryKey: ["challenges"],
    queryFn: async () => {
      const { data, error } = await supabase.from("challenges").select("*").order("start_date", { ascending: false });
      if (error) throw error;
      return (data ?? []) as Challenge[];
    },
  });

  const empQ = useQuery({
    queryKey: ["employees"],
    queryFn: async () => {
      const { data } = await supabase.from("employees").select("id,nome,slug").eq("ativo", true).order("ordem");
      return (data ?? []) as Emp[];
    },
  });

  const active = (chQ.data ?? []).filter((c) => c.ativo);
  const past = (chQ.data ?? []).filter((c) => !c.ativo || c.end_date < todayIso());

  return (
    <div>
      <PageHeader
        title="Desafios"
        subtitle="Metas personalizadas — diárias, semanais ou mensais"
        actions={
          <button
            onClick={() => setEditing({ tipo: "diario", scope: "loja", metric: "pts", target: 10, ativo: true, start_date: todayIso(), end_date: todayIso() })}
            className="inline-flex items-center gap-1.5 rounded-md border bg-card px-3 py-1.5 text-xs font-semibold hover:bg-accent"
          >
            <Plus className="h-3.5 w-3.5" /> Novo desafio
          </button>
        }
      />

      <div className="p-3 md:p-6 space-y-6">
        <section>
          <h2 className="mb-2 flex items-center gap-2 text-sm font-bold uppercase tracking-wider text-[var(--neon-yellow)]">
            <Trophy className="h-4 w-4" /> Ativos ({active.length})
          </h2>
          {chQ.isLoading && <p className="text-xs text-muted-foreground">A carregar…</p>}
          {!chQ.isLoading && active.length === 0 && (
            <p className="rounded-lg border border-dashed p-4 text-center text-sm text-muted-foreground">
              Sem desafios ativos. Cria um para arrancar a competição!
            </p>
          )}
          <div className="grid gap-3 md:grid-cols-2">
            {active.map((c) => (
              <ChallengeCard
                key={c.id}
                ch={c}
                employees={empQ.data ?? []}
                onEdit={() => setEditing(c)}
                onDelete={() => deleteChallenge(c)}
              />
            ))}
          </div>
        </section>

        {past.length > 0 && (
          <section>
            <h2 className="mb-2 text-xs font-bold uppercase tracking-wider text-muted-foreground">Arquivados ({past.length})</h2>
            <div className="grid gap-2 md:grid-cols-3">
              {past.map((c) => (
                <div key={c.id} className="rounded-md border bg-card/60 p-2 opacity-70">
                  <div className="flex items-center justify-between gap-2">
                    <div className="min-w-0">
                      <div className="truncate text-xs font-semibold">{c.titulo}</div>
                      <div className="text-[10px] text-muted-foreground">{c.tipo} · {c.start_date} → {c.end_date}</div>
                    </div>
                    <button
                      onClick={() => deleteChallenge(c)}
                      className="rounded p-1 hover:bg-accent"
                      title="Apagar"
                    >
                      <Trash2 className="h-3 w-3" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </section>
        )}
      </div>

      {editing && (
        <ChallengeEditor
          initial={editing}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); qc.invalidateQueries({ queryKey: ["challenges"] }); }}
        />
      )}
      {confirmDialog}
    </div>
  );
}

function ChallengeCard({ ch, employees, onEdit, onDelete }: {
  ch: Challenge;
  employees: Emp[];
  onEdit: () => void;
  onDelete: () => void;
}) {
  if (ch.metric === "nps_det") {
    return <NpsChallengeCard ch={ch} employees={employees} onEdit={onEdit} onDelete={onDelete} />;
  }

  const salesQ = useQuery({
    queryKey: ["sales-range", ch.start_date, ch.end_date],
    queryFn: async () => {
      const { data } = await supabase
        .from("sales_entries")
        .select("employee_id,product_id,quantidade")
        .gte("data", ch.start_date)
        .lte("data", ch.end_date);
      return (data ?? []) as { employee_id: string; product_id: string; quantidade: number }[];
    },
  });
  const prodQ = useQuery({
    queryKey: ["products-min"],
    queryFn: async () => (await supabase.from("products").select("id,codigo,peso")).data ?? [],
  });

  const prog = useMemo(
    () => computeProgress(salesQ.data ?? [], prodQ.data ?? [], ch.metric),
    [salesQ.data, prodQ.data, ch.metric],
  );

  const pct = ch.target > 0 ? Math.min(100, (prog.total / ch.target) * 100) : 0;
  const done = pct >= 100;
  const tipoLabel = ch.tipo === "diario" ? "Diário" : ch.tipo === "semanal" ? "Semanal" : "Mensal";

  return (
    <div
      className="rounded-xl border bg-card p-3 transition"
      style={{ boxShadow: done ? "0 0 22px color-mix(in oklab, var(--neon-green) 50%, transparent)" : undefined }}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <h3 className="truncate text-sm font-bold" style={{ color: "var(--neon-yellow)", textShadow: "0 0 8px color-mix(in oklab, var(--neon-yellow) 55%, transparent)" }}>
              {ch.titulo}
            </h3>
            {done && <span className="rounded-full bg-[color:var(--neon-green)]/20 px-2 py-0.5 text-[9px] font-bold uppercase text-[var(--neon-green)]">Concluído</span>}
          </div>
          {ch.descricao && <p className="mt-0.5 text-[11px] text-muted-foreground">{ch.descricao}</p>}
          <div className="mt-1 flex flex-wrap items-center gap-2 text-[10px] text-muted-foreground">
            <span className="inline-flex items-center gap-1"><CalendarDays className="h-3 w-3" /> {tipoLabel} · {ch.start_date}{ch.start_date !== ch.end_date ? ` → ${ch.end_date}` : ""}</span>
            <span className="inline-flex items-center gap-1"><Users2 className="h-3 w-3" /> {ch.scope === "loja" ? "Loja" : "Individual"}</span>
            <span className="inline-flex items-center gap-1"><Target className="h-3 w-3" /> {METRIC_LABELS[ch.metric]}</span>
            {ch.premio && <span className="rounded bg-[var(--neon-pink)]/15 px-1.5 py-0.5 text-[var(--neon-pink)]">🎁 {ch.premio}</span>}
          </div>
        </div>
        <div className="flex shrink-0 gap-1">
          <button onClick={onEdit} className="rounded p-1 hover:bg-accent" title="Editar"><Pencil className="h-3.5 w-3.5" /></button>
          <button onClick={onDelete} className="rounded p-1 hover:bg-accent" title="Apagar"><Trash2 className="h-3.5 w-3.5" /></button>
        </div>
      </div>

      {/* Barra progresso */}
      <div className="mt-2">
        <div className="flex items-baseline justify-between text-xs">
          <span className="tabular-nums font-bold" style={{ color: done ? "var(--neon-green)" : "var(--neon-blue)" }}>
            {fmtNum(prog.total, 2)} / {fmtNum(ch.target, 2)}
          </span>
          <span className="tabular-nums text-muted-foreground">{pct.toFixed(0)}%</span>
        </div>
        <div className="mt-1 h-2 overflow-hidden rounded-full bg-muted">
          <div
            className="h-full rounded-full transition-all"
            style={{
              width: `${pct}%`,
              background: done ? "var(--neon-green)" : "var(--neon-blue)",
              boxShadow: `0 0 10px ${done ? "var(--neon-green)" : "var(--neon-blue)"}`,
            }}
          />
        </div>
      </div>

      {/* Leaderboard individual */}
      {ch.scope === "individual" && employees.length > 0 && (
        <div className="mt-3 space-y-1">
          {[...employees]
            .map((e) => ({ e, v: prog.byEmp.get(e.id) ?? 0 }))
            .sort((a, b) => b.v - a.v)
            .slice(0, 5)
            .map(({ e, v }, i) => {
              const p = ch.target > 0 ? Math.min(100, (v / ch.target) * 100) : 0;
              const medal = ["🥇", "🥈", "🥉"][i] ?? `${i + 1}.`;
              return (
                <div key={e.id} className="flex items-center gap-2 text-[11px]">
                  <span className="w-5 text-center">{medal}</span>
                  <span className="min-w-0 flex-1 truncate">{e.nome}</span>
                  <span className="w-14 text-right tabular-nums font-semibold">{fmtNum(v, 2)}</span>
                  <div className="h-1.5 w-16 overflow-hidden rounded-full bg-muted">
                    <div className="h-full" style={{ width: `${p}%`, background: p >= 100 ? "var(--neon-green)" : "var(--neon-pink)" }} />
                  </div>
                </div>
              );
            })}
        </div>
      )}
    </div>
  );
}

/** NPS-detractor challenge: target is MAX allowed %; done when current <= target. */
function NpsChallengeCard({ ch, employees, onEdit, onDelete }: {
  ch: Challenge;
  employees: Emp[];
  onEdit: () => void;
  onDelete: () => void;
}) {
  const snapQ = useQuery({
    queryKey: ["nps-latest-for-challenge"],
    queryFn: async () => {
      const { data: snap } = await supabase
        .from("nps_snapshots").select("id,label")
        .order("created_at", { ascending: false }).limit(1).maybeSingle();
      if (!snap) return { scores: [] as any[] };
      const { data: scores } = await supabase
        .from("nps_scores")
        .select("employee_id,raw_name,inqueritos,det_pct,netscore")
        .eq("snapshot_id", snap.id);
      return { scores: scores ?? [] };
    },
  });

  const scores = snapQ.data?.scores ?? [];
  const targetPct = Number(ch.target); // ex: 15 (%)
  // Loja: média ponderada
  const totalInq = scores.reduce((a: number, s: any) => a + Number(s.inqueritos ?? 0), 0);
  const weightedDet = scores.reduce((a: number, s: any) => a + Number(s.det_pct ?? 0) * Number(s.inqueritos ?? 0), 0);
  const currentPct = totalInq > 0 ? (weightedDet / totalInq) * 100 : 0;
  const done = totalInq > 0 && currentPct <= targetPct;
  const tipoLabel = ch.tipo === "diario" ? "Diário" : ch.tipo === "semanal" ? "Semanal" : "Mensal";

  // Ajuste do progresso visual: 100% quando abaixo do alvo, decresce quando pior.
  const pct = targetPct > 0 ? Math.max(0, Math.min(100, (1 - (currentPct - targetPct) / Math.max(targetPct, 1)) * 100)) : 0;

  return (
    <div
      className="rounded-xl border bg-card p-3 transition"
      style={{ boxShadow: done ? "0 0 22px color-mix(in oklab, var(--neon-green) 50%, transparent)" : undefined }}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <h3 className="truncate text-sm font-bold" style={{ color: "var(--neon-yellow)", textShadow: "0 0 8px color-mix(in oklab, var(--neon-yellow) 55%, transparent)" }}>
              {ch.titulo}
            </h3>
            {done && <span className="rounded-full bg-[color:var(--neon-green)]/20 px-2 py-0.5 text-[9px] font-bold uppercase text-[var(--neon-green)]">Objetivo atingido</span>}
          </div>
          {ch.descricao && <p className="mt-0.5 text-[11px] text-muted-foreground">{ch.descricao}</p>}
          <div className="mt-1 flex flex-wrap items-center gap-2 text-[10px] text-muted-foreground">
            <span className="inline-flex items-center gap-1"><CalendarDays className="h-3 w-3" /> {tipoLabel} · {ch.start_date}{ch.start_date !== ch.end_date ? ` → ${ch.end_date}` : ""}</span>
            <span className="inline-flex items-center gap-1"><Users2 className="h-3 w-3" /> {ch.scope === "loja" ? "Loja" : "Individual"}</span>
            <span className="inline-flex items-center gap-1"><Target className="h-3 w-3" /> {METRIC_LABELS[ch.metric]} ≤ {targetPct}%</span>
            {ch.premio && <span className="rounded bg-[var(--neon-pink)]/15 px-1.5 py-0.5 text-[var(--neon-pink)]">🎁 {ch.premio}</span>}
          </div>
        </div>
        <div className="flex shrink-0 gap-1">
          <button onClick={onEdit} className="rounded p-1 hover:bg-accent" title="Editar"><Pencil className="h-3.5 w-3.5" /></button>
          <button onClick={onDelete} className="rounded p-1 hover:bg-accent" title="Apagar"><Trash2 className="h-3.5 w-3.5" /></button>
        </div>
      </div>

      {ch.scope === "loja" && (
        <div className="mt-2">
          <div className="flex items-baseline justify-between text-xs">
            <span className="tabular-nums font-bold" style={{ color: done ? "var(--neon-green)" : "var(--neon-pink)" }}>
              {currentPct.toFixed(1)}% <span className="text-muted-foreground font-normal">≤ {targetPct}%</span>
            </span>
            <span className="tabular-nums text-muted-foreground">{totalInq} inquéritos</span>
          </div>
          <div className="mt-1 h-2 overflow-hidden rounded-full bg-muted">
            <div
              className="h-full rounded-full transition-all"
              style={{
                width: `${pct}%`,
                background: done ? "var(--neon-green)" : "var(--neon-pink)",
                boxShadow: `0 0 10px ${done ? "var(--neon-green)" : "var(--neon-pink)"}`,
              }}
            />
          </div>
        </div>
      )}

      {ch.scope === "individual" && (
        <div className="mt-3 space-y-1">
          {employees
            .map((e) => {
              const s = scores.find((x: any) => x.employee_id === e.id);
              return { e, det: s ? Number(s.det_pct) * 100 : null, inq: s ? Number(s.inqueritos) : 0 };
            })
            .filter((x) => x.inq > 0)
            .sort((a, b) => (a.det ?? 999) - (b.det ?? 999))
            .slice(0, 8)
            .map(({ e, det, inq }, i) => {
              const ok = det != null && det <= targetPct;
              const medal = ok ? ["🥇", "🥈", "🥉"][i] ?? "✓" : "⚠";
              return (
                <div key={e.id} className="flex items-center gap-2 text-[11px]">
                  <span className="w-5 text-center">{medal}</span>
                  <span className="min-w-0 flex-1 truncate">{e.nome}</span>
                  <span className="w-8 text-right tabular-nums text-muted-foreground">{inq}</span>
                  <span
                    className="w-14 text-right tabular-nums font-semibold"
                    style={{ color: ok ? "var(--neon-green)" : "var(--neon-pink)" }}
                  >
                    {det != null ? `${det.toFixed(1)}%` : "—"}
                  </span>
                </div>
              );
            })}
          {scores.length === 0 && (
            <p className="text-[11px] text-muted-foreground">Sem snapshot NPS. Importa em /nps.</p>
          )}
        </div>
      )}
    </div>
  );
}

function ChallengeEditor({ initial, onClose, onSaved }: {
  initial: Partial<Challenge>;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [c, setC] = useState<Partial<Challenge>>(initial);
  const [saving, setSaving] = useState(false);

  function setTipo(tipo: "diario" | "semanal" | "mensal") {
    const s = new Date(c.start_date ?? todayIso());
    const e = new Date(s);
    if (tipo === "semanal") e.setDate(s.getDate() + 6);
    else if (tipo === "mensal") { e.setMonth(s.getMonth() + 1); e.setDate(0); }
    setC({ ...c, tipo, end_date: ymd(e) });
  }

  async function save() {
    if (!c.titulo?.trim()) return toast.error("Título obrigatório");
    setSaving(true);
    const payload = {
      titulo: c.titulo.trim(),
      descricao: c.descricao?.trim() || null,
      tipo: c.tipo ?? "diario",
      start_date: c.start_date ?? todayIso(),
      end_date: c.end_date ?? todayIso(),
      scope: c.scope ?? "loja",
      metric: c.metric ?? "pts",
      target: Number(c.target ?? 0),
      premio: c.premio?.trim() || null,
      ativo: c.ativo ?? true,
    };
    const { error } = c.id
      ? await supabase.from("challenges").update(payload).eq("id", c.id)
      : await supabase.from("challenges").insert(payload);
    setSaving(false);
    if (error) return toast.error(error.message);
    toast.success(c.id ? "Atualizado" : "Criado");
    onSaved();
  }

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/60 p-3" onClick={onClose}>
      <div
        className="w-full max-w-lg rounded-xl border bg-card p-4 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
        style={{ boxShadow: "0 0 40px color-mix(in oklab, var(--neon-yellow) 40%, transparent)" }}
      >
        <div className="mb-3 flex items-center justify-between">
          <h3 className="text-sm font-bold uppercase tracking-wider text-[var(--neon-yellow)]">
            {c.id ? "Editar desafio" : "Novo desafio"}
          </h3>
          <button onClick={onClose} className="rounded p-1 hover:bg-accent"><X className="h-4 w-4" /></button>
        </div>

        <div className="space-y-2 text-sm">
          <label className="block">
            <span className="text-[11px] text-muted-foreground">Título</span>
            <input value={c.titulo ?? ""} onChange={(e) => setC({ ...c, titulo: e.target.value })} className="w-full rounded border bg-background px-2 py-1.5" placeholder="Ex.: Corrida ao Alarme" />
          </label>
          <label className="block">
            <span className="text-[11px] text-muted-foreground">Descrição (opcional)</span>
            <textarea value={c.descricao ?? ""} onChange={(e) => setC({ ...c, descricao: e.target.value })} rows={2} className="w-full rounded border bg-background px-2 py-1.5" />
          </label>

          <div className="grid grid-cols-3 gap-2">
            {(["diario", "semanal", "mensal"] as const).map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => setTipo(t)}
                className={classNames(
                  "rounded-md border px-2 py-1.5 text-xs font-semibold capitalize",
                  c.tipo === t && "border-[var(--neon-yellow)] text-[var(--neon-yellow)]",
                )}
              >
                {t}
              </button>
            ))}
          </div>

          <div className="grid grid-cols-2 gap-2">
            <label className="block">
              <span className="text-[11px] text-muted-foreground">Início</span>
              <input type="date" value={c.start_date ?? ""} onChange={(e) => setC({ ...c, start_date: e.target.value })} className="w-full rounded border bg-background px-2 py-1.5" />
            </label>
            <label className="block">
              <span className="text-[11px] text-muted-foreground">Fim</span>
              <input type="date" value={c.end_date ?? ""} onChange={(e) => setC({ ...c, end_date: e.target.value })} className="w-full rounded border bg-background px-2 py-1.5" />
            </label>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <label className="block">
              <span className="text-[11px] text-muted-foreground">Âmbito</span>
              <select value={c.scope ?? "loja"} onChange={(e) => setC({ ...c, scope: e.target.value as any })} className="w-full rounded border bg-background px-2 py-1.5">
                <option value="loja">Loja (soma equipa)</option>
                <option value="individual">Individual (leaderboard)</option>
              </select>
            </label>
            <label className="block">
              <span className="text-[11px] text-muted-foreground">Métrica</span>
              <select value={c.metric ?? "pts"} onChange={(e) => setC({ ...c, metric: e.target.value as Metric })} className="w-full rounded border bg-background px-2 py-1.5">
                {Object.entries(METRIC_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
            </label>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <label className="block">
              <span className="text-[11px] text-muted-foreground">
                {REDUCTION_METRICS.has((c.metric ?? "pts") as Metric) ? "Alvo máximo (%)" : "Alvo"}
              </span>
              <input type="number" step="0.25" value={c.target ?? 0} onChange={(e) => setC({ ...c, target: Number(e.target.value) })} className="w-full rounded border bg-background px-2 py-1.5 tabular-nums" />
            </label>
            <label className="block">
              <span className="text-[11px] text-muted-foreground">Prémio (opcional)</span>
              <input value={c.premio ?? ""} onChange={(e) => setC({ ...c, premio: e.target.value })} className="w-full rounded border bg-background px-2 py-1.5" placeholder="Ex.: Voucher 20€" />
            </label>
          </div>

          <label className="flex items-center gap-2 text-xs">
            <input type="checkbox" checked={c.ativo ?? true} onChange={(e) => setC({ ...c, ativo: e.target.checked })} />
            Ativo
          </label>
        </div>

        <div className="mt-4 flex justify-end gap-2">
          <button onClick={onClose} className="rounded border px-3 py-1.5 text-xs hover:bg-accent">Cancelar</button>
          <button onClick={save} disabled={saving} className="inline-flex items-center gap-1.5 rounded bg-[var(--neon-yellow)] px-3 py-1.5 text-xs font-bold text-black hover:opacity-90 disabled:opacity-50">
            <Check className="h-3.5 w-3.5" /> {saving ? "A guardar…" : "Guardar"}
          </button>
        </div>
      </div>
    </div>
  );
}
