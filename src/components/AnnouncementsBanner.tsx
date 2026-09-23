import { useMemo } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { Megaphone, Check, UserCircle } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { useMyEmployee } from "@/hooks/use-my-employee";
import { ymd } from "@/lib/domain";

type Row = {
  id: string; titulo: string; corpo: string | null; prioridade: string;
  ativo: boolean; expira_em: string | null; created_at: string; employee_id: string | null;
};

function cor(p: string) {
  if (p === "urgente") return "var(--neon-pink)";
  if (p === "importante") return "var(--neon-yellow)";
  return "var(--neon-blue)";
}

/** Mostra os avisos ativos ainda não lidos pelo utilizador atual. */
export function AnnouncementsBanner() {
  const qc = useQueryClient();
  const { user } = useAuth();
  const { employeeId } = useMyEmployee();
  const hoje = ymd(new Date());

  const listQ = useQuery({
    queryKey: ["announcements"],
    queryFn: async () => {
      const { data, error } = await supabase.from("announcements").select("*").order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as Row[];
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

  const pendentes = useMemo(() => {
    const read = new Set(readsQ.data ?? []);
    return (listQ.data ?? []).filter(
      (a) =>
        a.ativo &&
        !read.has(a.id) &&
        (!a.expira_em || a.expira_em >= hoje) &&
        (a.employee_id === null || a.employee_id === employeeId),
    );
  }, [listQ.data, readsQ.data, hoje, employeeId]);

  async function marcarLido(id: string) {
    if (!user?.id) return;
    await supabase.from("announcement_reads").insert({ announcement_id: id, user_id: user.id });
    qc.invalidateQueries({ queryKey: ["announcement-reads", user.id] });
    qc.invalidateQueries({ queryKey: ["reminder-avisos"] });
  }

  if (pendentes.length === 0) return null;

  return (
    <div className="space-y-2">
      {pendentes.slice(0, 3).map((a) => {
        const c = cor(a.prioridade);
        return (
          <div key={a.id} className="rounded-xl border bg-card p-3 animate-fade-in" style={{ borderLeft: `3px solid ${c}` }}>
            <div className="flex flex-wrap items-center gap-2">
              <Megaphone className="h-4 w-4 shrink-0" style={{ color: c }} />
              <span className="text-sm font-semibold">{a.titulo}</span>
              {a.employee_id && (
                <span className="inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-bold"
                  style={{ borderColor: "var(--neon-pink)", color: "var(--neon-pink)" }}>
                  <UserCircle className="h-3 w-3" /> Só para ti
                </span>
              )}
              <span className="rounded-full px-2 py-0.5 text-[10px] font-bold uppercase"
                style={{ background: `color-mix(in oklab, ${c} 20%, transparent)`, color: c }}>{a.prioridade}</span>
              <button onClick={() => marcarLido(a.id)}
                className="ml-auto inline-flex items-center gap-1 rounded-md border px-2 py-1 text-[11px] hover:bg-muted">
                <Check className="h-3 w-3" /> Li
              </button>
            </div>
            {a.corpo && <p className="mt-1.5 whitespace-pre-wrap text-sm text-foreground/80">{a.corpo}</p>}
          </div>
        );
      })}
      {pendentes.length > 3 && (
        <Link to="/avisos" className="block text-xs text-muted-foreground hover:underline">
          + {pendentes.length - 3} avisos por ler
        </Link>
      )}
    </div>
  );
}
