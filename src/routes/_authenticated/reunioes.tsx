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
import { CalendarClock, Plus, Trash2, Save } from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/reunioes")({
  head: pageHead("Reuniões 1:1 · PDS LoureShopping", "Agenda de reuniões individuais com notas e follow-ups."),
  errorComponent: ({ error, reset }) => <RouteError error={error} reset={reset} />,
  notFoundComponent: () => <RouteNotFound />,
  component: ReunioesPage,
});

type Meeting = {
  id: string; employee_id: string; data: string; hora: string | null; assunto: string | null;
  notas: string | null; follow_up: string | null; estado: string;
};

const ESTADOS = ["agendada", "realizada", "cancelada"] as const;

function estadoCor(e: string) {
  if (e === "realizada") return "var(--neon-green)";
  if (e === "cancelada") return "var(--neon-pink)";
  return "var(--neon-blue)";
}

function ReunioesPage() {
  const qc = useQueryClient();
  const isAdmin = useIsAdmin();
  const { user } = useAuth();
  const { confirm, dialog } = useConfirm();
  const [filtroEmp, setFiltroEmp] = useState("");
  const [editing, setEditing] = useState<Record<string, { notas: string; follow_up: string }>>({});
  const [form, setForm] = useState({ employee_id: "", data: ymd(new Date()), hora: "10:00", assunto: "" });

  const empsQ = useQuery({
    queryKey: ["employees"],
    queryFn: async () =>
      (await supabase.from("employees").select("id,nome,slug,username_sgf,categoria,ativo,ordem").eq("ativo", true).order("ordem")).data ?? [],
  });

  const meetQ = useQuery({
    queryKey: ["one-on-ones"],
    queryFn: async () => {
      const { data, error } = await supabase.from("one_on_ones").select("*").order("data", { ascending: false });
      if (error) throw error;
      return (data ?? []) as Meeting[];
    },
  });

  const nomes = useMemo(() => new Map((empsQ.data ?? []).map((e) => [e.id, e.nome])), [empsQ.data]);
  const rows = useMemo(
    () => (meetQ.data ?? []).filter((m) => !filtroEmp || m.employee_id === filtroEmp),
    [meetQ.data, filtroEmp],
  );

  async function add() {
    if (!form.employee_id) return toast.error("Escolhe o colaborador");
    const { error } = await supabase.from("one_on_ones").insert({
      employee_id: form.employee_id, data: form.data, hora: form.hora || null,
      assunto: form.assunto.trim() || null, created_by: user?.id ?? null,
    });
    if (error) return toast.error(error.message);
    toast.success("Reunião agendada");
    setForm({ ...form, assunto: "" });
    qc.invalidateQueries({ queryKey: ["one-on-ones"] });
  }

  async function patch(id: string, p: Partial<Meeting>) {
    const { error } = await supabase.from("one_on_ones").update(p).eq("id", id);
    if (error) return toast.error(error.message);
    qc.invalidateQueries({ queryKey: ["one-on-ones"] });
  }

  async function guardar(m: Meeting) {
    const e = editing[m.id];
    if (!e) return;
    await patch(m.id, { notas: e.notas || null, follow_up: e.follow_up || null });
    toast.success("Notas guardadas");
  }

  async function remove(m: Meeting) {
    if (!(await confirm({ title: "Eliminar reunião?", confirmLabel: "Eliminar", destructive: true }))) return;
    const { error } = await supabase.from("one_on_ones").delete().eq("id", m.id);
    if (error) return toast.error(error.message);
    qc.invalidateQueries({ queryKey: ["one-on-ones"] });
  }

  return (
    <div>
      {dialog}
      <PageHeader title="Reuniões 1:1" subtitle={`${rows.length} reuniões`} />
      <div className="p-4 md:p-6 space-y-4">
        {isAdmin && (
          <div className="rounded-xl border bg-card p-4">
            <h3 className="mb-3 text-sm font-semibold">Agendar reunião</h3>
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
              <select value={form.employee_id} onChange={(e) => setForm({ ...form, employee_id: e.target.value })}
                className="rounded-md border bg-background px-3 py-2 text-sm">
                <option value="">Colaborador…</option>
                {(empsQ.data ?? []).map((e) => <option key={e.id} value={e.id}>{e.nome}</option>)}
              </select>
              <input type="date" value={form.data} onChange={(e) => setForm({ ...form, data: e.target.value })}
                className="rounded-md border bg-background px-3 py-2 text-sm" />
              <input type="time" value={form.hora} onChange={(e) => setForm({ ...form, hora: e.target.value })}
                className="rounded-md border bg-background px-3 py-2 text-sm" />
              <input value={form.assunto} onChange={(e) => setForm({ ...form, assunto: e.target.value })}
                placeholder="Assunto" className="rounded-md border bg-background px-3 py-2 text-sm" />
              <button onClick={add} className="inline-flex items-center justify-center gap-1.5 rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground hover:opacity-90">
                <Plus className="h-4 w-4" /> Agendar
              </button>
            </div>
          </div>
        )}

        {isAdmin ? (
          <select value={filtroEmp} onChange={(e) => setFiltroEmp(e.target.value)}
            className="rounded-md border bg-background px-3 py-2 text-sm">
            <option value="">Todos os colaboradores</option>
            {(empsQ.data ?? []).map((e) => <option key={e.id} value={e.id}>{e.nome}</option>)}
          </select>
        ) : (
          <p className="text-[11px] text-muted-foreground">Vês apenas as tuas reuniões individuais.</p>
        )}

        {rows.length === 0 ? (
          <EmptyState title="Sem reuniões" hint="Agenda a primeira reunião individual." icon={<CalendarClock className="h-6 w-6" />} />
        ) : (
          <div className="grid gap-3">
            {rows.map((m) => {
              const cor = estadoCor(m.estado);
              const ed = editing[m.id] ?? { notas: m.notas ?? "", follow_up: m.follow_up ?? "" };
              return (
                <div key={m.id} className="rounded-xl border bg-card p-4" style={{ borderLeft: `3px solid ${cor}` }}>
                  <div className="flex flex-wrap items-center gap-2">
                    <CalendarClock className="h-4 w-4" style={{ color: cor }} />
                    <h3 className="text-sm font-semibold">{nomes.get(m.employee_id) ?? "Colaborador"}</h3>
                    <span className="text-xs text-muted-foreground">{m.data}{m.hora ? ` · ${m.hora}` : ""}</span>
                    {m.assunto && <span className="text-xs text-foreground/80">· {m.assunto}</span>}
                    <div className="ml-auto flex items-center gap-2">
                      {isAdmin ? (
                        <select value={m.estado} onChange={(e) => patch(m.id, { estado: e.target.value })}
                          className="rounded-md border bg-background px-2 py-1 text-xs">
                          {ESTADOS.map((s) => <option key={s} value={s}>{s}</option>)}
                        </select>
                      ) : (
                        <span className={classNames("rounded-full px-2 py-0.5 text-[11px] font-semibold")}
                          style={{ background: `color-mix(in oklab, ${cor} 20%, transparent)`, color: cor }}>{m.estado}</span>
                      )}
                      {isAdmin && (
                        <button onClick={() => remove(m)} className="text-muted-foreground hover:text-destructive" aria-label="Eliminar">
                          <Trash2 className="h-4 w-4" />
                        </button>
                      )}
                    </div>
                  </div>

                  {isAdmin ? (
                    <div className="mt-3 grid gap-2 md:grid-cols-2">
                      <textarea rows={3} value={ed.notas}
                        onChange={(e) => setEditing({ ...editing, [m.id]: { ...ed, notas: e.target.value } })}
                        placeholder="Notas da reunião" className="rounded-md border bg-background px-3 py-2 text-sm" />
                      <textarea rows={3} value={ed.follow_up}
                        onChange={(e) => setEditing({ ...editing, [m.id]: { ...ed, follow_up: e.target.value } })}
                        placeholder="Follow-up / compromissos" className="rounded-md border bg-background px-3 py-2 text-sm" />
                      <div>
                        <button onClick={() => guardar(m)} className="inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-xs font-medium hover:bg-muted">
                          <Save className="h-3.5 w-3.5" /> Guardar notas
                        </button>
                      </div>
                    </div>
                  ) : (
                    (m.notas || m.follow_up) && (
                      <div className="mt-3 grid gap-2 text-sm md:grid-cols-2">
                        {m.notas && <p className="whitespace-pre-wrap text-foreground/85"><span className="text-xs text-muted-foreground">Notas: </span>{m.notas}</p>}
                        {m.follow_up && <p className="whitespace-pre-wrap text-foreground/85"><span className="text-xs text-muted-foreground">Follow-up: </span>{m.follow_up}</p>}
                      </div>
                    )
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
