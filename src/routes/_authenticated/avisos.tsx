import { createFileRoute } from "@tanstack/react-router";
import { RouteError, RouteNotFound, pageHead, EmptyState } from "@/components/RouteBoundary";
import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/AppShell";
import { useIsAdmin } from "@/hooks/use-is-admin";
import { useAuth } from "@/hooks/use-auth";
import { useConfirm } from "@/components/ConfirmDialog";
import { classNames } from "@/lib/domain";
import { Megaphone, Plus, Trash2, Check, EyeOff, Eye, UserCircle } from "lucide-react";
import { useMyEmployee } from "@/hooks/use-my-employee";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/avisos")({
  head: pageHead("Avisos · PDS LoureShopping", "Comunicados e informações importantes da loja."),
  errorComponent: ({ error, reset }) => <RouteError error={error} reset={reset} />,
  notFoundComponent: () => <RouteNotFound />,
  component: AvisosPage,
});

export type Announcement = {
  id: string; titulo: string; corpo: string | null; prioridade: string;
  ativo: boolean; expira_em: string | null; created_at: string; employee_id: string | null;
};

export const PRIORIDADES = ["normal", "importante", "urgente"] as const;

export function prioridadeCor(p: string) {
  if (p === "urgente") return "var(--neon-pink)";
  if (p === "importante") return "var(--neon-yellow)";
  return "var(--neon-blue)";
}

function AvisosPage() {
  const qc = useQueryClient();
  const isAdmin = useIsAdmin();
  const { user } = useAuth();
  const { confirm, dialog } = useConfirm();
  const { employeeId } = useMyEmployee();
  const [form, setForm] = useState({ titulo: "", corpo: "", prioridade: "normal", expira_em: "", employee_id: "" });

  const empQ = useQuery({
    queryKey: ["employees-min"],
    queryFn: async () => {
      const { data, error } = await supabase.from("employees").select("id,nome").eq("ativo", true).order("ordem");
      if (error) throw error;
      return (data ?? []) as { id: string; nome: string }[];
    },
  });
  const empNome = useMemo(() => {
    const m = new Map<string, string>();
    for (const e of empQ.data ?? []) m.set(e.id, e.nome);
    return m;
  }, [empQ.data]);

  const listQ = useQuery({
    queryKey: ["announcements"],
    queryFn: async () => {
      const { data, error } = await supabase.from("announcements").select("*").order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as Announcement[];
    },
  });

  const readsQ = useQuery({
    queryKey: ["announcement-reads", user?.id],
    enabled: !!user?.id,
    queryFn: async () => {
      const { data, error } = await supabase.from("announcement_reads").select("announcement_id").eq("user_id", user!.id);
      if (error) throw error;
      return (data ?? []).map((r) => r.announcement_id);
    },
  });

  const readSet = useMemo(() => new Set(readsQ.data ?? []), [readsQ.data]);

  async function add() {
    if (!form.titulo.trim()) return toast.error("Falta o título");
    const { error } = await supabase.from("announcements").insert({
      titulo: form.titulo.trim(),
      corpo: form.corpo.trim() || null,
      prioridade: form.prioridade,
      expira_em: form.expira_em || null,
      employee_id: form.employee_id || null,
      created_by: user?.id ?? null,
    });
    if (error) return toast.error(error.message);
    toast.success("Aviso publicado");
    setForm({ titulo: "", corpo: "", prioridade: "normal", expira_em: "", employee_id: "" });
    qc.invalidateQueries({ queryKey: ["announcements"] });
  }

  async function toggleAtivo(a: Announcement) {
    const { error } = await supabase.from("announcements").update({ ativo: !a.ativo }).eq("id", a.id);
    if (error) return toast.error(error.message);
    qc.invalidateQueries({ queryKey: ["announcements"] });
  }

  async function remove(a: Announcement) {
    if (!(await confirm({ title: `Eliminar "${a.titulo}"?`, confirmLabel: "Eliminar", destructive: true }))) return;
    const { error } = await supabase.from("announcements").delete().eq("id", a.id);
    if (error) return toast.error(error.message);
    qc.invalidateQueries({ queryKey: ["announcements"] });
  }

  async function marcarLido(a: Announcement) {
    if (!user?.id || readSet.has(a.id)) return;
    const { error } = await supabase.from("announcement_reads").insert({ announcement_id: a.id, user_id: user.id });
    if (error) return toast.error(error.message);
    qc.invalidateQueries({ queryKey: ["announcement-reads", user.id] });
  }

  const rows = useMemo(
    () => (listQ.data ?? []).filter((a) => isAdmin || a.employee_id === null || a.employee_id === employeeId),
    [listQ.data, isAdmin, employeeId],
  );

  return (
    <div>
      {dialog}
      <PageHeader title="Quadro de avisos" subtitle={`${rows.filter((r) => r.ativo).length} avisos ativos`} />
      <div className="p-4 md:p-6 space-y-4">
        {isAdmin && (
          <div className="rounded-xl border bg-card p-4">
            <h3 className="mb-3 text-sm font-semibold">Novo comunicado</h3>
            <div className="grid gap-2">
              <input value={form.titulo} onChange={(e) => setForm({ ...form, titulo: e.target.value })}
                placeholder="Título" className="rounded-md border bg-background px-3 py-2 text-sm" />
              <textarea value={form.corpo} onChange={(e) => setForm({ ...form, corpo: e.target.value })}
                placeholder="Mensagem" rows={3} className="rounded-md border bg-background px-3 py-2 text-sm" />
              <div className="grid gap-2 sm:grid-cols-[160px_1fr_1fr_auto]">
                <select value={form.prioridade} onChange={(e) => setForm({ ...form, prioridade: e.target.value })}
                  className="rounded-md border bg-background px-3 py-2 text-sm">
                  {PRIORIDADES.map((p) => <option key={p} value={p}>{p}</option>)}
                </select>
                <select value={form.employee_id} onChange={(e) => setForm({ ...form, employee_id: e.target.value })}
                  className="rounded-md border bg-background px-3 py-2 text-sm" title="Destinatário">
                  <option value="">Toda a loja</option>
                  {(empQ.data ?? []).map((e) => <option key={e.id} value={e.id}>{e.nome}</option>)}
                </select>
                <input type="date" value={form.expira_em} onChange={(e) => setForm({ ...form, expira_em: e.target.value })}
                  className="rounded-md border bg-background px-3 py-2 text-sm" title="Expira em (opcional)" />
                <button onClick={add} className="inline-flex items-center justify-center gap-1.5 rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground hover:opacity-90">
                  <Plus className="h-4 w-4" /> Publicar
                </button>
              </div>
            </div>
          </div>
        )}

        {rows.length === 0 ? (
          <EmptyState title="Sem avisos" hint="Os comunicados publicados aparecem aqui." icon={<Megaphone className="h-6 w-6" />} />
        ) : (
          <div className="grid gap-3">
            {rows.map((a) => {
              const cor = prioridadeCor(a.prioridade);
              const lido = readSet.has(a.id);
              return (
                <div key={a.id}
                  className={classNames("rounded-xl border bg-card p-4", !a.ativo && "opacity-55")}
                  style={{ borderLeft: `3px solid ${cor}` }}>
                  <div className="flex flex-wrap items-center gap-2">
                    <Megaphone className="h-4 w-4" style={{ color: cor }} />
                    <h3 className="text-sm font-semibold">{a.titulo}</h3>
                    <span className="rounded-full px-2 py-0.5 text-[10px] font-bold uppercase"
                      style={{ background: `color-mix(in oklab, ${cor} 20%, transparent)`, color: cor }}>
                      {a.prioridade}
                    </span>
                    {a.employee_id && (
                      <span className="inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-semibold"
                        style={{ borderColor: "var(--neon-pink)", color: "var(--neon-pink)" }}>
                        <UserCircle className="h-3 w-3" />
                        {a.employee_id === employeeId ? "Só para ti" : (empNome.get(a.employee_id) ?? "Pessoal")}
                      </span>
                    )}
                    {!a.ativo && <span className="text-[11px] text-muted-foreground">arquivado</span>}
                    <span className="ml-auto text-[11px] text-muted-foreground">
                      {new Date(a.created_at).toLocaleDateString("pt-PT")}
                    </span>
                  </div>
                  {a.corpo && <p className="mt-2 whitespace-pre-wrap text-sm text-foreground/85">{a.corpo}</p>}
                  {a.expira_em && <p className="mt-1 text-[11px] text-muted-foreground">Válido até {a.expira_em}</p>}
                  <div className="mt-3 flex flex-wrap gap-2">
                    <button onClick={() => marcarLido(a)} disabled={lido}
                      className={classNames(
                        "inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-xs font-medium",
                        lido ? "text-muted-foreground" : "hover:bg-muted",
                      )}>
                      <Check className="h-3.5 w-3.5" /> {lido ? "Lido" : "Marcar como lido"}
                    </button>
                    {isAdmin && (
                      <>
                        <button onClick={() => toggleAtivo(a)} className="inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-xs hover:bg-muted">
                          {a.ativo ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                          {a.ativo ? "Arquivar" : "Reativar"}
                        </button>
                        <button onClick={() => remove(a)} className="inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-xs text-destructive hover:bg-destructive/10">
                          <Trash2 className="h-3.5 w-3.5" /> Eliminar
                        </button>
                      </>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
