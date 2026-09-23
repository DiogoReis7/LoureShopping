import { createFileRoute } from "@tanstack/react-router";
import { RouteError, RouteNotFound, pageHead, EmptyState } from "@/components/RouteBoundary";
import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/AppShell";
import { useIsAdmin } from "@/hooks/use-is-admin";
import { useAuth } from "@/hooks/use-auth";
import { useConfirm } from "@/components/ConfirmDialog";
import { ymd, classNames } from "@/lib/domain";
import { Plus, Trash2, CalendarOff } from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/ausencias")({
  head: pageHead("Ausências · PDS LoureShopping", "Faltas, atrasos, férias e justificações da equipa."),
  errorComponent: ({ error, reset }) => <RouteError error={error} reset={reset} />,
  notFoundComponent: () => <RouteNotFound />,
  component: AusenciasPage,
});

const TIPOS = ["falta", "atraso", "férias", "baixa médica", "consulta", "formação", "outro"] as const;
const ESTADOS = ["pendente", "justificada", "não justificada"] as const;

type Absence = {
  id: string; employee_id: string; tipo: string; data_inicio: string; data_fim: string;
  motivo: string | null; estado: string; notas: string | null;
};

function estadoCor(e: string) {
  if (e === "justificada") return "var(--neon-green)";
  if (e === "não justificada") return "var(--neon-pink)";
  return "var(--neon-yellow)";
}

function AusenciasPage() {
  const qc = useQueryClient();
  const isAdmin = useIsAdmin();
  const { user } = useAuth();
  const { confirm, dialog } = useConfirm();
  const [filtroEmp, setFiltroEmp] = useState("");
  const [filtroTipo, setFiltroTipo] = useState("");

  const hoje = ymd(new Date());
  const [form, setForm] = useState({
    employee_id: "", tipo: "falta", data_inicio: hoje, data_fim: hoje, motivo: "", estado: "pendente", notas: "",
  });

  const empsQ = useQuery({
    queryKey: ["employees"],
    queryFn: async () =>
      (await supabase.from("employees").select("id,nome,slug,username_sgf,categoria,ativo,ordem").eq("ativo", true).order("ordem")).data ?? [],
  });

  const absQ = useQuery({
    queryKey: ["absences"],
    queryFn: async () => {
      const { data, error } = await supabase.from("absences").select("*").order("data_inicio", { ascending: false });
      if (error) throw error;
      return (data ?? []) as Absence[];
    },
  });

  const nomes = useMemo(() => {
    const m = new Map<string, string>();
    for (const e of empsQ.data ?? []) m.set(e.id, e.nome);
    return m;
  }, [empsQ.data]);

  const rows = useMemo(() => (absQ.data ?? []).filter((a) =>
    (!filtroEmp || a.employee_id === filtroEmp) && (!filtroTipo || a.tipo === filtroTipo)
  ), [absQ.data, filtroEmp, filtroTipo]);

  async function add() {
    if (!form.employee_id) return toast.error("Escolhe o colaborador");
    if (form.data_fim < form.data_inicio) return toast.error("Data final anterior à inicial");
    const { error } = await supabase.from("absences").insert({ ...form, created_by: user?.id ?? null });
    if (error) return toast.error(error.message);
    toast.success("Ausência registada");
    setForm({ ...form, motivo: "", notas: "" });
    qc.invalidateQueries({ queryKey: ["absences"] });
  }

  async function setEstado(id: string, estado: string) {
    const { error } = await supabase.from("absences").update({ estado }).eq("id", id);
    if (error) return toast.error(error.message);
    qc.invalidateQueries({ queryKey: ["absences"] });
  }

  async function remove(a: Absence) {
    if (!(await confirm({
      title: "Eliminar registo?",
      description: `${nomes.get(a.employee_id) ?? "Colaborador"} · ${a.tipo} (${a.data_inicio})`,
      confirmLabel: "Eliminar", destructive: true,
    }))) return;
    const { error } = await supabase.from("absences").delete().eq("id", a.id);
    if (error) return toast.error(error.message);
    qc.invalidateQueries({ queryKey: ["absences"] });
  }

  return (
    <div>
      {dialog}
      <PageHeader title="Ausências" subtitle={`${rows.length} registos`} />
      <div className="p-4 md:p-6 space-y-4">
        {isAdmin && (
          <div className="rounded-xl border bg-card p-4">
            <h3 className="mb-3 text-sm font-semibold">Novo registo</h3>
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
              <select value={form.employee_id} onChange={(e) => setForm({ ...form, employee_id: e.target.value })}
                className="rounded-md border bg-background px-3 py-2 text-sm">
                <option value="">Colaborador…</option>
                {(empsQ.data ?? []).map((e) => <option key={e.id} value={e.id}>{e.nome}</option>)}
              </select>
              <select value={form.tipo} onChange={(e) => setForm({ ...form, tipo: e.target.value })}
                className="rounded-md border bg-background px-3 py-2 text-sm">
                {TIPOS.map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
              <input type="date" value={form.data_inicio} onChange={(e) => setForm({ ...form, data_inicio: e.target.value })}
                className="rounded-md border bg-background px-3 py-2 text-sm" />
              <input type="date" value={form.data_fim} onChange={(e) => setForm({ ...form, data_fim: e.target.value })}
                className="rounded-md border bg-background px-3 py-2 text-sm" />
              <input value={form.motivo} onChange={(e) => setForm({ ...form, motivo: e.target.value })}
                placeholder="Motivo" className="rounded-md border bg-background px-3 py-2 text-sm lg:col-span-2" />
              <select value={form.estado} onChange={(e) => setForm({ ...form, estado: e.target.value })}
                className="rounded-md border bg-background px-3 py-2 text-sm">
                {ESTADOS.map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
              <button onClick={add} className="inline-flex items-center justify-center gap-1.5 rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground hover:opacity-90">
                <Plus className="h-4 w-4" /> Registar
              </button>
            </div>
          </div>
        )}

        <div className="flex flex-wrap gap-2">
          <select value={filtroEmp} onChange={(e) => setFiltroEmp(e.target.value)}
            className="rounded-md border bg-background px-3 py-2 text-sm">
            <option value="">Todos os colaboradores</option>
            {(empsQ.data ?? []).map((e) => <option key={e.id} value={e.id}>{e.nome}</option>)}
          </select>
          <select value={filtroTipo} onChange={(e) => setFiltroTipo(e.target.value)}
            className="rounded-md border bg-background px-3 py-2 text-sm">
            <option value="">Todos os tipos</option>
            {TIPOS.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
        </div>

        {rows.length === 0 ? (
          <EmptyState title="Sem ausências registadas" hint="Os registos aparecem aqui assim que forem criados." icon={<CalendarOff className="h-6 w-6" />} />
        ) : (
          <div className="overflow-x-auto rounded-xl border bg-card">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-xs uppercase text-muted-foreground">
                  <th className="px-3 py-2">Colaborador</th>
                  <th className="px-3 py-2">Tipo</th>
                  <th className="px-3 py-2">Período</th>
                  <th className="px-3 py-2">Motivo</th>
                  <th className="px-3 py-2">Estado</th>
                  {isAdmin && <th className="px-3 py-2" />}
                </tr>
              </thead>
              <tbody className="divide-y">
                {rows.map((a) => (
                  <tr key={a.id}>
                    <td className="px-3 py-2 font-medium">{nomes.get(a.employee_id) ?? "—"}</td>
                    <td className="px-3 py-2 capitalize">{a.tipo}</td>
                    <td className="px-3 py-2 whitespace-nowrap">
                      {a.data_inicio === a.data_fim ? a.data_inicio : `${a.data_inicio} → ${a.data_fim}`}
                    </td>
                    <td className="px-3 py-2 text-muted-foreground">{a.motivo || "—"}</td>
                    <td className="px-3 py-2">
                      {isAdmin ? (
                        <select value={a.estado} onChange={(e) => setEstado(a.id, e.target.value)}
                          className="rounded-md border bg-background px-2 py-1 text-xs">
                          {ESTADOS.map((t) => <option key={t} value={t}>{t}</option>)}
                        </select>
                      ) : (
                        <span className={classNames("rounded-full px-2 py-0.5 text-[11px] font-semibold")}
                          style={{ background: `color-mix(in oklab, ${estadoCor(a.estado)} 20%, transparent)`, color: estadoCor(a.estado) }}>
                          {a.estado}
                        </span>
                      )}
                    </td>
                    {isAdmin && (
                      <td className="px-3 py-2 text-right">
                        <button onClick={() => remove(a)} className="text-muted-foreground hover:text-destructive" aria-label="Eliminar">
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
