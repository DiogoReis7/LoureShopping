import { createFileRoute } from "@tanstack/react-router";
import { RouteError, RouteNotFound, pageHead, EmptyState } from "@/components/RouteBoundary";
import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/AppShell";
import { useIsAdmin } from "@/hooks/use-is-admin";
import { useAuth } from "@/hooks/use-auth";
import { useConfirm } from "@/components/ConfirmDialog";
import { ymd } from "@/lib/domain";
import { Award, Trophy, Heart, Shield, Zap, Phone, Calendar, Plus, Trash2, Medal } from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/conquistas")({
  head: pageHead("Conquistas · PDS LoureShopping", "Muro da fama: badges e conquistas da equipa."),
  errorComponent: ({ error, reset }) => <RouteError error={error} reset={reset} />,
  notFoundComponent: () => <RouteNotFound />,
  component: ConquistasPage,
});

type Badge = { id: string; codigo: string; nome: string; descricao: string | null; icone: string; cor: string; ordem: number; ativo: boolean };
type EmpBadge = { id: string; employee_id: string; badge_id: string; data: string; motivo: string | null };

const ICONS: Record<string, typeof Trophy> = {
  trophy: Trophy, heart: Heart, shield: Shield, zap: Zap, phone: Phone, calendar: Calendar, award: Award, medal: Medal,
};

export function BadgeIcon({ icone, cor, size = 20 }: { icone: string; cor: string; size?: number }) {
  const Icon = ICONS[icone] ?? Award;
  return <Icon style={{ color: cor, width: size, height: size }} />;
}

function ConquistasPage() {
  const qc = useQueryClient();
  const isAdmin = useIsAdmin();
  const { user } = useAuth();
  const { confirm, dialog } = useConfirm();
  const [form, setForm] = useState({ employee_id: "", badge_id: "", data: ymd(new Date()), motivo: "" });

  const empsQ = useQuery({
    queryKey: ["employees"],
    queryFn: async () =>
      (await supabase.from("employees").select("id,nome,slug,username_sgf,categoria,ativo,ordem").eq("ativo", true).order("ordem")).data ?? [],
  });

  const badgesQ = useQuery({
    queryKey: ["badges"],
    queryFn: async () => {
      const { data, error } = await supabase.from("badges").select("*").eq("ativo", true).order("ordem");
      if (error) throw error;
      return (data ?? []) as Badge[];
    },
  });

  const empBadgesQ = useQuery({
    queryKey: ["employee-badges"],
    queryFn: async () => {
      const { data, error } = await supabase.from("employee_badges").select("*").order("data", { ascending: false });
      if (error) throw error;
      return (data ?? []) as EmpBadge[];
    },
  });

  const badgeById = useMemo(() => new Map((badgesQ.data ?? []).map((b) => [b.id, b])), [badgesQ.data]);
  const empById = useMemo(() => new Map((empsQ.data ?? []).map((e) => [e.id, e])), [empsQ.data]);

  const porColaborador = useMemo(() => {
    const m = new Map<string, EmpBadge[]>();
    for (const eb of empBadgesQ.data ?? []) {
      if (!m.has(eb.employee_id)) m.set(eb.employee_id, []);
      m.get(eb.employee_id)!.push(eb);
    }
    return [...m.entries()].sort((a, b) => b[1].length - a[1].length);
  }, [empBadgesQ.data]);

  async function atribuir() {
    if (!form.employee_id || !form.badge_id) return toast.error("Escolhe colaborador e conquista");
    const { error } = await supabase.from("employee_badges").insert({
      employee_id: form.employee_id, badge_id: form.badge_id, data: form.data,
      motivo: form.motivo.trim() || null, created_by: user?.id ?? null,
    });
    if (error) return toast.error(error.message.includes("duplicate") ? "Já atribuída nesse dia" : error.message);
    toast.success("Conquista atribuída");
    setForm({ ...form, motivo: "" });
    qc.invalidateQueries({ queryKey: ["employee-badges"] });
  }

  async function remover(eb: EmpBadge) {
    if (!(await confirm({ title: "Remover conquista?", confirmLabel: "Remover", destructive: true }))) return;
    const { error } = await supabase.from("employee_badges").delete().eq("id", eb.id);
    if (error) return toast.error(error.message);
    qc.invalidateQueries({ queryKey: ["employee-badges"] });
  }

  return (
    <div>
      {dialog}
      <PageHeader title="Muro da fama" subtitle={`${empBadgesQ.data?.length ?? 0} conquistas atribuídas`} />
      <div className="p-4 md:p-6 space-y-4">
        {isAdmin && (
          <div className="rounded-xl border bg-card p-4">
            <h3 className="mb-3 text-sm font-semibold">Atribuir conquista</h3>
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
              <select value={form.employee_id} onChange={(e) => setForm({ ...form, employee_id: e.target.value })}
                className="rounded-md border bg-background px-3 py-2 text-sm">
                <option value="">Colaborador…</option>
                {(empsQ.data ?? []).map((e) => <option key={e.id} value={e.id}>{e.nome}</option>)}
              </select>
              <select value={form.badge_id} onChange={(e) => setForm({ ...form, badge_id: e.target.value })}
                className="rounded-md border bg-background px-3 py-2 text-sm">
                <option value="">Conquista…</option>
                {(badgesQ.data ?? []).map((b) => <option key={b.id} value={b.id}>{b.nome}</option>)}
              </select>
              <input type="date" value={form.data} onChange={(e) => setForm({ ...form, data: e.target.value })}
                className="rounded-md border bg-background px-3 py-2 text-sm" />
              <input value={form.motivo} onChange={(e) => setForm({ ...form, motivo: e.target.value })}
                placeholder="Motivo (opcional)" className="rounded-md border bg-background px-3 py-2 text-sm" />
              <button onClick={atribuir} className="inline-flex items-center justify-center gap-1.5 rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground hover:opacity-90">
                <Plus className="h-4 w-4" /> Atribuir
              </button>
            </div>
          </div>
        )}

        <div className="rounded-xl border bg-card p-4">
          <h3 className="mb-3 text-sm font-semibold">Conquistas disponíveis</h3>
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {(badgesQ.data ?? []).map((b) => (
              <div key={b.id} className="flex items-center gap-3 rounded-lg border p-3"
                style={{ borderColor: `color-mix(in oklab, ${b.cor} 40%, transparent)` }}>
                <div className="grid h-10 w-10 shrink-0 place-items-center rounded-full"
                  style={{ background: `color-mix(in oklab, ${b.cor} 18%, transparent)` }}>
                  <BadgeIcon icone={b.icone} cor={b.cor} />
                </div>
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold">{b.nome}</p>
                  <p className="truncate text-xs text-muted-foreground">{b.descricao}</p>
                </div>
              </div>
            ))}
          </div>
        </div>

        {porColaborador.length === 0 ? (
          <EmptyState title="Ainda sem conquistas" hint="Assim que forem atribuídas aparecem aqui." icon={<Award className="h-6 w-6" />} />
        ) : (
          <div className="grid gap-3 md:grid-cols-2">
            {porColaborador.map(([empId, list]) => (
              <div key={empId} className="rounded-xl border bg-card p-4">
                <div className="flex items-center gap-2">
                  <Medal className="h-4 w-4" style={{ color: "var(--neon-yellow)" }} />
                  <h3 className="text-sm font-semibold">{empById.get(empId)?.nome ?? "Colaborador"}</h3>
                  <span className="ml-auto text-xs text-muted-foreground">{list.length}</span>
                </div>
                <ul className="mt-3 space-y-2">
                  {list.map((eb) => {
                    const b = badgeById.get(eb.badge_id);
                    if (!b) return null;
                    return (
                      <li key={eb.id} className="flex items-center gap-2.5">
                        <BadgeIcon icone={b.icone} cor={b.cor} size={16} />
                        <span className="text-sm">{b.nome}</span>
                        <span className="text-[11px] text-muted-foreground">{eb.data}</span>
                        {eb.motivo && <span className="truncate text-[11px] text-muted-foreground">· {eb.motivo}</span>}
                        {isAdmin && (
                          <button onClick={() => remover(eb)} className="ml-auto text-muted-foreground hover:text-destructive" aria-label="Remover">
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        )}
                      </li>
                    );
                  })}
                </ul>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
