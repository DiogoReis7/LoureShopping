import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { useConfirm } from "@/components/ConfirmDialog";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "sonner";
import { ymd } from "@/lib/domain";
import {
  Megaphone, Plus, Trash2, EyeOff, Eye, UserCircle,
  CalendarClock, Save, Users, Check, X,
} from "lucide-react";
type Announcement = {
  id: string; titulo: string; corpo: string | null; prioridade: string;
  ativo: boolean; expira_em: string | null; created_at: string; employee_id: string | null;
};
const PRIORIDADES = ["normal", "importante", "urgente"] as const;
function prioridadeCor(p: string) {
  if (p === "urgente") return "var(--neon-pink)";
  if (p === "importante") return "var(--neon-yellow)";
  return "var(--neon-blue)";
}

type Emp = {
  id: string; nome: string; username_sgf: string | null; categoria: string | null;
  objetivo_pontos: number | null; ativo: boolean; ordem: number;
};

function useEmps() {
  return useQuery({
    queryKey: ["admin-hub-employees"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("employees")
        .select("id,nome,username_sgf,categoria,objetivo_pontos,ativo,ordem")
        .order("ordem");
      if (error) throw error;
      return (data ?? []) as Emp[];
    },
  });
}

const inputCls = "rounded-md border bg-background px-3 py-2 text-sm";

// ===================== AVISOS =====================
export function AdminAnnouncements() {
  const qc = useQueryClient();
  const { user } = useAuth();
  const { confirm, dialog } = useConfirm();
  const empsQ = useEmps();
  const [form, setForm] = useState({ titulo: "", corpo: "", prioridade: "normal", expira_em: "", employee_id: "" });

  const listQ = useQuery({
    queryKey: ["announcements"],
    queryFn: async () => {
      const { data, error } = await supabase.from("announcements").select("*").order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as Announcement[];
    },
  });

  const empNome = useMemo(() => new Map((empsQ.data ?? []).map((e) => [e.id, e.nome])), [empsQ.data]);

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

  return (
    <div className="space-y-4">
      {dialog}
      <div className="rounded-xl border bg-card p-4">
        <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold">
          <Megaphone className="h-4 w-4" /> Novo comunicado
        </h3>
        <div className="grid gap-2">
          <input value={form.titulo} onChange={(e) => setForm({ ...form, titulo: e.target.value })}
            placeholder="Título" className={inputCls} />
          <textarea value={form.corpo} onChange={(e) => setForm({ ...form, corpo: e.target.value })}
            placeholder="Mensagem" rows={2} className={inputCls} />
          <div className="grid gap-2 sm:grid-cols-[140px_1fr_1fr_auto]">
            <select value={form.prioridade} onChange={(e) => setForm({ ...form, prioridade: e.target.value })} className={inputCls}>
              {PRIORIDADES.map((p) => <option key={p} value={p}>{p}</option>)}
            </select>
            <select value={form.employee_id} onChange={(e) => setForm({ ...form, employee_id: e.target.value })} className={inputCls} title="Destinatário">
              <option value="">Toda a loja</option>
              {(empsQ.data ?? []).filter((e) => e.ativo).map((e) => <option key={e.id} value={e.id}>{e.nome}</option>)}
            </select>
            <input type="date" value={form.expira_em} onChange={(e) => setForm({ ...form, expira_em: e.target.value })} className={inputCls} title="Expira em (opcional)" />
            <button onClick={add} className="inline-flex items-center justify-center gap-1.5 rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground hover:opacity-90">
              <Plus className="h-4 w-4" /> Publicar
            </button>
          </div>
        </div>
      </div>

      <div className="grid gap-2">
        {listQ.isLoading && <Skeleton className="h-20 w-full" />}
        {(listQ.data ?? []).map((a) => {
          const cor = prioridadeCor(a.prioridade);
          return (
            <div key={a.id} className={`rounded-xl border bg-card p-3 ${!a.ativo ? "opacity-55" : ""}`}
              style={{ borderLeft: `3px solid ${cor}` }}>
              <div className="flex flex-wrap items-center gap-2">
                <h4 className="text-sm font-semibold">{a.titulo}</h4>
                <span className="rounded-full px-2 py-0.5 text-[10px] font-bold uppercase"
                  style={{ background: `color-mix(in oklab, ${cor} 20%, transparent)`, color: cor }}>
                  {a.prioridade}
                </span>
                {a.employee_id && (
                  <span className="inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-semibold">
                    <UserCircle className="h-3 w-3" /> {empNome.get(a.employee_id) ?? "Pessoal"}
                  </span>
                )}
                {!a.ativo && <span className="text-[11px] text-muted-foreground">arquivado</span>}
                <span className="ml-auto text-[11px] text-muted-foreground">
                  {new Date(a.created_at).toLocaleDateString("pt-PT")}
                </span>
              </div>
              {a.corpo && <p className="mt-1 line-clamp-2 whitespace-pre-wrap text-xs text-foreground/80">{a.corpo}</p>}
              <div className="mt-2 flex gap-2">
                <button onClick={() => toggleAtivo(a)} className="inline-flex items-center gap-1 rounded-md border px-2 py-1 text-[11px] hover:bg-muted">
                  {a.ativo ? <EyeOff className="h-3 w-3" /> : <Eye className="h-3 w-3" />}
                  {a.ativo ? "Arquivar" : "Reativar"}
                </button>
                <button onClick={() => remove(a)} className="inline-flex items-center gap-1 rounded-md border px-2 py-1 text-[11px] text-destructive hover:bg-destructive/10">
                  <Trash2 className="h-3 w-3" /> Eliminar
                </button>
              </div>
            </div>
          );
        })}
        {!listQ.isLoading && (listQ.data ?? []).length === 0 && (
          <p className="rounded-xl border bg-card p-6 text-center text-xs text-muted-foreground">Sem avisos publicados.</p>
        )}
      </div>
    </div>
  );
}

// ===================== REUNIÕES =====================
type Meeting = {
  id: string; employee_id: string; data: string; hora: string | null; assunto: string | null;
  notas: string | null; follow_up: string | null; estado: string;
};
const ESTADOS = ["agendada", "realizada", "cancelada"] as const;

export function AdminMeetings() {
  const qc = useQueryClient();
  const { user } = useAuth();
  const { confirm, dialog } = useConfirm();
  const empsQ = useEmps();
  const [form, setForm] = useState({ employee_id: "", data: ymd(new Date()), hora: "10:00", assunto: "" });
  const [editing, setEditing] = useState<Record<string, { notas: string; follow_up: string }>>({});

  const meetQ = useQuery({
    queryKey: ["one-on-ones"],
    queryFn: async () => {
      const { data, error } = await supabase.from("one_on_ones").select("*").order("data", { ascending: false });
      if (error) throw error;
      return (data ?? []) as Meeting[];
    },
  });

  const nomes = useMemo(() => new Map((empsQ.data ?? []).map((e) => [e.id, e.nome])), [empsQ.data]);

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

  async function remove(m: Meeting) {
    if (!(await confirm({ title: "Eliminar reunião?", confirmLabel: "Eliminar", destructive: true }))) return;
    const { error } = await supabase.from("one_on_ones").delete().eq("id", m.id);
    if (error) return toast.error(error.message);
    qc.invalidateQueries({ queryKey: ["one-on-ones"] });
  }

  return (
    <div className="space-y-4">
      {dialog}
      <div className="rounded-xl border bg-card p-4">
        <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold">
          <CalendarClock className="h-4 w-4" /> Agendar reunião 1:1
        </h3>
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
          <select value={form.employee_id} onChange={(e) => setForm({ ...form, employee_id: e.target.value })} className={inputCls}>
            <option value="">Colaborador…</option>
            {(empsQ.data ?? []).filter((e) => e.ativo).map((e) => <option key={e.id} value={e.id}>{e.nome}</option>)}
          </select>
          <input type="date" value={form.data} onChange={(e) => setForm({ ...form, data: e.target.value })} className={inputCls} />
          <input type="time" value={form.hora} onChange={(e) => setForm({ ...form, hora: e.target.value })} className={inputCls} />
          <input value={form.assunto} onChange={(e) => setForm({ ...form, assunto: e.target.value })} placeholder="Assunto" className={inputCls} />
          <button onClick={add} className="inline-flex items-center justify-center gap-1.5 rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground hover:opacity-90">
            <Plus className="h-4 w-4" /> Agendar
          </button>
        </div>
      </div>

      <div className="grid gap-2">
        {meetQ.isLoading && <Skeleton className="h-20 w-full" />}
        {(meetQ.data ?? []).map((m) => {
          const ed = editing[m.id] ?? { notas: m.notas ?? "", follow_up: m.follow_up ?? "" };
          return (
            <div key={m.id} className="rounded-xl border bg-card p-3">
              <div className="flex flex-wrap items-center gap-2">
                <h4 className="text-sm font-semibold">{nomes.get(m.employee_id) ?? "Colaborador"}</h4>
                <span className="text-xs text-muted-foreground">{m.data}{m.hora ? ` · ${m.hora}` : ""}</span>
                {m.assunto && <span className="text-xs text-foreground/80">· {m.assunto}</span>}
                <div className="ml-auto flex items-center gap-2">
                  <select value={m.estado} onChange={(e) => patch(m.id, { estado: e.target.value })}
                    className="rounded-md border bg-background px-2 py-1 text-xs">
                    {ESTADOS.map((s) => <option key={s} value={s}>{s}</option>)}
                  </select>
                  <button onClick={() => remove(m)} className="text-muted-foreground hover:text-destructive" aria-label="Eliminar">
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              </div>
              <div className="mt-2 grid gap-2 md:grid-cols-2">
                <textarea rows={2} value={ed.notas}
                  onChange={(e) => setEditing({ ...editing, [m.id]: { ...ed, notas: e.target.value } })}
                  placeholder="Notas da reunião" className={inputCls} />
                <textarea rows={2} value={ed.follow_up}
                  onChange={(e) => setEditing({ ...editing, [m.id]: { ...ed, follow_up: e.target.value } })}
                  placeholder="Follow-up / compromissos" className={inputCls} />
              </div>
              <button onClick={async () => {
                await patch(m.id, { notas: ed.notas || null, follow_up: ed.follow_up || null });
                toast.success("Notas guardadas");
              }} className="mt-2 inline-flex items-center gap-1 rounded-md border px-2 py-1 text-[11px] font-medium hover:bg-muted">
                <Save className="h-3 w-3" /> Guardar notas
              </button>
            </div>
          );
        })}
        {!meetQ.isLoading && (meetQ.data ?? []).length === 0 && (
          <p className="rounded-xl border bg-card p-6 text-center text-xs text-muted-foreground">Sem reuniões agendadas.</p>
        )}
      </div>
    </div>
  );
}

// ===================== COLABORADORES =====================
export function AdminEmployees() {
  const qc = useQueryClient();
  const empsQ = useEmps();
  const [draft, setDraft] = useState<Record<string, Partial<Emp>>>({});
  const [busy, setBusy] = useState<string | null>(null);

  function field(e: Emp, k: keyof Emp) {
    return draft[e.id]?.[k] !== undefined ? (draft[e.id] as any)[k] : (e[k] ?? "");
  }

  function setField(e: Emp, k: keyof Emp, v: unknown) {
    setDraft((d) => ({ ...d, [e.id]: { ...d[e.id], [k]: v } }));
  }

  async function save(e: Emp) {
    const d = draft[e.id];
    if (!d) return;
    setBusy(e.id);
    const payload: { nome?: string; username_sgf?: string | null; categoria?: string | null; objetivo_pontos?: number | null } = {};
    if (d.nome !== undefined) payload.nome = String(d.nome).trim();
    if (d.username_sgf !== undefined) payload.username_sgf = String(d.username_sgf).trim() || null;
    if (d.categoria !== undefined) payload.categoria = String(d.categoria).trim() || null;
    if (d.objetivo_pontos !== undefined) {
      const v = d.objetivo_pontos as number | string | null;
      payload.objetivo_pontos = v === "" || v === null ? null : Number(v);
    }
    const { error } = await supabase.from("employees").update(payload as never).eq("id", e.id);
    setBusy(null);
    if (error) return toast.error(error.message);
    toast.success(`${e.nome} atualizado`);
    setDraft((dd) => { const nd = { ...dd }; delete nd[e.id]; return nd; });
    qc.invalidateQueries({ queryKey: ["admin-hub-employees"] });
    qc.invalidateQueries({ queryKey: ["employees"] });
  }

  async function toggleAtivo(e: Emp) {
    const { error } = await supabase.from("employees").update({ ativo: !e.ativo }).eq("id", e.id);
    if (error) return toast.error(error.message);
    qc.invalidateQueries({ queryKey: ["admin-hub-employees"] });
    qc.invalidateQueries({ queryKey: ["employees"] });
  }

  return (
    <div className="overflow-x-auto rounded-xl border bg-card">
      <table className="w-full min-w-[640px] text-sm">
        <thead>
          <tr className="border-b bg-muted/50 text-xs">
            <th className="px-3 py-2 text-left">Nome</th>
            <th className="px-3 py-2 text-left">Utilizador SGF</th>
            <th className="px-3 py-2 text-left">Categoria</th>
            <th className="px-3 py-2 text-left">Obj. pontos</th>
            <th className="px-3 py-2 text-left">Estado</th>
            <th className="px-3 py-2"></th>
          </tr>
        </thead>
        <tbody>
          {empsQ.isLoading && (
            <tr><td colSpan={6} className="px-3 py-4"><Skeleton className="h-6 w-full" /></td></tr>
          )}
          {(empsQ.data ?? []).map((e) => {
            const dirty = !!draft[e.id];
            return (
              <tr key={e.id} className="border-b last:border-0 align-middle">
                <td className="px-3 py-2">
                  <input value={field(e, "nome") as string} onChange={(ev) => setField(e, "nome", ev.target.value)}
                    className="w-40 rounded border bg-background px-2 py-1 text-xs" />
                </td>
                <td className="px-3 py-2">
                  <input value={field(e, "username_sgf") as string} onChange={(ev) => setField(e, "username_sgf", ev.target.value)}
                    className="w-32 rounded border bg-background px-2 py-1 text-xs" placeholder="—" />
                </td>
                <td className="px-3 py-2">
                  <input value={field(e, "categoria") as string} onChange={(ev) => setField(e, "categoria", ev.target.value)}
                    className="w-28 rounded border bg-background px-2 py-1 text-xs" placeholder="—" />
                </td>
                <td className="px-3 py-2">
                  <input type="number" value={field(e, "objetivo_pontos") as any} onChange={(ev) => setField(e, "objetivo_pontos", ev.target.value)}
                    className="w-20 rounded border bg-background px-2 py-1 text-xs" placeholder="—" />
                </td>
                <td className="px-3 py-2">
                  <button onClick={() => toggleAtivo(e)}
                    className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${e.ativo ? "bg-success/15 text-success" : "bg-muted text-muted-foreground"}`}>
                    {e.ativo ? "Ativo" : "Inativo"}
                  </button>
                </td>
                <td className="px-3 py-2 text-right">
                  {dirty && (
                    <span className="inline-flex items-center gap-1">
                      <button disabled={busy === e.id} onClick={() => save(e)}
                        className="rounded-md p-1.5 text-success hover:bg-success/10" title="Guardar">
                        <Check className="h-4 w-4" />
                      </button>
                      <button onClick={() => setDraft((dd) => { const nd = { ...dd }; delete nd[e.id]; return nd; })}
                        className="rounded-md p-1.5 text-muted-foreground hover:bg-accent" title="Cancelar">
                        <X className="h-4 w-4" />
                      </button>
                    </span>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <p className="border-t px-3 py-2 text-[11px] text-muted-foreground">
        <Users className="mr-1 inline h-3 w-3" />
        Edita os campos diretamente e clica no visto para guardar. Inativos não aparecem nos registos diários.
      </p>
    </div>
  );
}
