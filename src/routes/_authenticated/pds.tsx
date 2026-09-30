import { createFileRoute } from "@tanstack/react-router";
import { RouteError, RouteNotFound, pageHead } from "@/components/RouteBoundary";
import { useEffect, useMemo, useRef, useState } from "react";
import { chime, fanfare, unlockAudio } from "@/lib/sound";
import { haptic } from "@/lib/haptics";
import { AnimatedNumber } from "@/components/AnimatedNumber";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronDown, Camera, Copy, Check, Share2, Tv, Play, Pause, Volume2, VolumeX, ShoppingCart, Sparkles, Trophy, Timer, Flag } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { withoutManagers } from "@/lib/manager";
import { PageHeader } from "@/components/AppShell";
import { MonthDayPicker } from "@/components/MonthDayPicker";
import { useSharedDate } from "@/hooks/useSharedDate";
import { MONTHS_PT, monthRange, fmtNum, fmtSecsAsTime, ymd, classNames, initials, avatarGradient } from "@/lib/domain";
import { NeonIcon, NeonBadge, pickIcon } from "@/lib/product-icons";
import { computeProgress, METRIC_LABELS, REDUCTION_METRICS, type Metric } from "@/lib/challenges";

import { NpsAlertBanner } from "@/components/NpsAlertBanner";
import { isMedicalLeave, isSalesBlockedShift } from "@/lib/shift-state";



export const Route = createFileRoute("/_authenticated/pds")({
  head: pageHead("PDS do dia · LoureShopping", "Painel diário de vendas, senhas e indicadores da loja."),
  errorComponent: ({ error, reset }) => <RouteError error={error} reset={reset} />,
  notFoundComponent: () => <RouteNotFound />,
  component: PdsPage,
});
