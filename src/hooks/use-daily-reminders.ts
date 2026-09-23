import { useEffect, useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { useMyEmployee } from "@/hooks/use-my-employee";
import { ymd } from "@/lib/domain";
import { readNotifPrefs } from "@/lib/notif-prefs";

const KEY = "pds:reminders";

function jaAvisado(slot: string, dia: string) {
  if (typeof localStorage === "undefined") return true;
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) || "{}") as Record<string, string>;
    return raw[slot] === dia;
  } catch {
    return false;
  }
}

function marcarAvisado(slot: string, dia: string) {
  if (typeof localStorage === "undefined") return;
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) || "{}") as Record<string, string>;
    raw[slot] = dia;
    localStorage.setItem(KEY, JSON.stringify(raw));
  } catch {
    /* ignora */
  }
}

function notificar(titulo: string, corpo: string, ativo: boolean) {
  if (!ativo) return;
  if (typeof window === "undefined" || !("Notification" in window)) return;
  if (Notification.permission === "granted") {
    try {
      new Notification(titulo, { body: corpo, icon: "/app-icon-20260920-192.png" });
    } catch {
      /* ignora */
    }
  }
}

/** Pede permissão de notificações do browser (uma vez, após interação). */
export function pedirPermissaoNotificacoes() {
  if (typeof window === "undefined" || !("Notification" in window)) return Promise.resolve("denied" as const);
  if (Notification.permission !== "default") return Promise.resolve(Notification.permission);
  return Notification.requestPermission();
}

/**
 * Lembretes diários de avisos por ler (globais e pessoais).
 * Cada lembrete surge no máximo uma vez por dia e por dispositivo.
 */
export function useDailyReminders(onOpenAvisos?: () => void) {
  const { user } = useAuth();
  const { employeeId } = useMyEmployee();
  const dia = ymd(new Date());
  const shownRef = useRef(false);

  const avisosQ = useQuery({
    queryKey: ["reminder-avisos", user?.id, employeeId],
    enabled: !!user?.id,
    refetchInterval: 5 * 60_000,
    queryFn: async () => {
      const [list, reads] = await Promise.all([
        supabase.from("announcements").select("id,titulo,prioridade,ativo,expira_em,employee_id"),
        supabase.from("announcement_reads").select("announcement_id").eq("user_id", user!.id),
      ]);
      if (list.error) throw list.error;
      if (reads.error) throw reads.error;
      const lidos = new Set((reads.data ?? []).map((r) => r.announcement_id));
      return (list.data ?? []).filter(
        (a) =>
          a.ativo &&
          !lidos.has(a.id) &&
          (!a.expira_em || a.expira_em >= dia) &&
          (a.employee_id === null || a.employee_id === employeeId),
      );
    },
  });

  useEffect(() => {
    if (shownRef.current) return;
    if (!user?.id) return;
    const avisos = avisosQ.data;
    if (!avisos) return;
    const prefs = readNotifPrefs(user.id);
    if (!prefs.avisos) return;
    shownRef.current = true;

    const pessoais = avisos.filter((a) => a.employee_id !== null);
    if (avisos.length > 0 && !jaAvisado("avisos", dia)) {
      marcarAvisado("avisos", dia);
      const titulo = pessoais.length > 0
        ? `Tens ${pessoais.length} aviso(s) só para ti`
        : `${avisos.length} aviso(s) por ler`;
      toast.info(titulo, {
        description: avisos[0]?.titulo ?? "Abre o quadro de avisos.",
        duration: 12000,
        action: onOpenAvisos ? { label: "Ver", onClick: onOpenAvisos } : undefined,
      });
      notificar(titulo, avisos[0]?.titulo ?? "Abre o quadro de avisos.", prefs.sistema);
    }
  }, [avisosQ.data, user?.id, dia, onOpenAvisos]);

  return {
    avisosPorLer: avisosQ.data?.length ?? 0,
    avisosPessoais: (avisosQ.data ?? []).filter((a) => a.employee_id !== null).length,
  };
}
