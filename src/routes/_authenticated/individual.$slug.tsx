import { createFileRoute, notFound, Link } from "@tanstack/react-router";
import { RouteError, RouteNotFound, pageHead } from "@/components/RouteBoundary";
import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/AppShell";
import { MonthDayPicker } from "@/components/MonthDayPicker";
import { useSharedDate } from "@/hooks/useSharedDate";
import { MONTHS_PT, fmtNum, fmtSecsAsTime, ymd, classNames } from "@/lib/domain";
import {
  ArrowLeft, Minus, Plus, TrendingUp, Package, Ticket, Timer, Clock, Trophy, Lock, Search,
} from "lucide-react";
import { toast } from "sonner";
import { useIsAdmin } from "@/hooks/use-is-admin";
import { NeonIcon, pickIcon, pickIconByCode } from "@/lib/product-icons";
import { useNpsAlert, NPS_DET_THRESHOLD } from "@/hooks/use-nps-alert";
import { AlertTriangle } from "lucide-react";
import { IndividualNpsPanel } from "@/components/IndividualNpsPanel";
import { isMedicalLeave, isMeeting, isSalesBlockedShift } from "@/lib/shift-state";

export const Route = createFileRoute("/_authenticated/individual/$slug")({
  head: pageHead("Desempenho individual · PDS LoureShopping", "Vendas, pontos, senhas e NPS de cada colaborador."),
  errorComponent: ({ error, reset }) => <RouteError error={error} reset={reset} />,
  notFoundComponent: () => <RouteNotFound />,
  component: IndividualPage,
});

type Product = {
  id: string; codigo: string; nome: string;
  categoria: string | null; peso: number; ativo: boolean; ordem: number;
};
type Sale = { employee_id: string; product_id: string; data: string; quantidade: number };

function normalize(s: string | null | undefined) {
  return (s ?? "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

// Buckets iguais ao PDS / Quadro IOS
const FIXO_CODES = new Set(["tv", "net", "voz", "wifi-total", "migracoes", "migracoes-tv"]);
const MOVEL_CODES = new Set(["cv", "cv-por-retencao", "pp", "pre-pagos"]);
const MARCACOES_CODES = new Set(["sm-1a", "sm-2a", "sm-1a-estrela", "sm-2a-estrela", "sm-1a-movel", "sm-2a-movel", "xpert", "ecn", "premium", "segue-retencao"]);
const NEGOCIO_CODES = new Set(["alarmes", "alarme", "smp", "smp-retoma", "acess", "pelicula", "seguro", "seg-fat", "device", "hotspot", "energia", "energia-sa", "cv-retoma", "retoma"]);

function bucketOf(codigo: string): { key: string; label: string; color: string; order: number } {
  const c = codigo.toLowerCase();
  if (c === "nc") return { key: "nc", label: "NC — Novos Contratos", color: "var(--neon-green)", order: 0 };
  if (FIXO_CODES.has(c)) return { key: "fixo", label: "FIXO", color: "var(--neon-yellow)", order: 1 };
  if (MOVEL_CODES.has(c)) return { key: "movel", label: "MÓVEL", color: "var(--neon-blue)", order: 2 };
  if (MARCACOES_CODES.has(c)) return { key: "marcacoes", label: "MARCAÇÕES", color: "var(--neon-violet)", order: 3 };
  if (NEGOCIO_CODES.has(c)) return { key: "negocio", label: "+NEGÓCIO", color: "var(--neon-orange)", order: 4 };
  if (c === "combina") return { key: "combina", label: "COMBINA · Continente", color: "var(--neon-pink)", order: 5 };
  return { key: "outros", label: "Outros", color: "var(--neon-blue)", order: 9 };
}
