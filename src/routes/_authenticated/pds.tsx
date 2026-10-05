// Indicadores do PDS (por código de produto). Móvel e Combina NÃO contam.
const MARCACOES_CODES = new Set(["sm-1a", "sm-2a", "sm-1a-estrela", "sm-2a-estrela", "sm-1a-movel", "sm-2a-movel", "xpert", "ecn", "premium", "segue-retencao"]);
const MOVEL_CODES = new Set(["cv", "cv-por-retencao", "pp", "pre-pagos"]);
const RETOMA_CODES = new Set(["cv-retoma", "retoma"]);
const FIXO_CODES = new Set(["tv", "net", "voz", "wifi-total", "migracoes", "migracoes-tv"]);
// Códigos excluídos do total "Ponderado" / %TEP (alinhado com /desempenho, /desafios e /tv).
const EXCLUDED_FROM_PTS = new Set(["combina", "nc"]);

function normalize(s: string | null | undefined) {
  return (s ?? "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

function PdsPage() {
  const [{ year, month, day }, setDate] = useSharedDate();
  const { start, end } = monthRange(year, month);
  const dayIso = ymd(new Date(year, month - 1, day));

  const sgfQ = useQuery({
    queryKey: ["sgf-day", dayIso],
    queryFn: async () => {
      const { data } = await supabase
        .from("sgf_tickets")
        .select("senha,estado,espera_s,atendimento_s,emitida_em,employee_id,inicio_em,fim_em")
        .gte("emitida_em", dayIso + "T00:00:00")
        .lte("emitida_em", dayIso + "T23:59:59");
      return (data ?? []) as Ticket[];
    },
  });

  const empQ = useQuery({
    queryKey: ["employees", "all-active"],
    queryFn: async () => {
      const { data } = await supabase.from("employees").select("id,nome,slug,username_sgf,ativo,ordem,categoria,objetivo_mes,notas").eq("ativo", true).order("ordem");
      return (data ?? []) as Employee[];
    },
  });

  const opsEmployees = useMemo(() => withoutManagers(empQ.data ?? [] as any) as Employee[], [empQ.data]);

  const shiftDayQ = useQuery({
    queryKey: ["shift-day", dayIso],
    queryFn: async () => {
      const { data } = await supabase
        .from("shift_days")
        .select("employee_id,horas,estado,descricao")
        .eq("data", dayIso);
      return (data ?? []) as { employee_id: string; horas: number | null; estado: string | null; descricao: string | null }[];
    },
  });

  const prodQ = useQuery({
    queryKey: ["products"],
    queryFn: async () => {
      const { data } = await supabase.from("products").select("id,codigo,nome,categoria,peso,ativo,ordem").eq("ativo", true).order("ordem");
      return (data ?? []) as Product[];
    },
  });

  const salesQ = useQuery({
    queryKey: ["sales-day", dayIso],
    queryFn: async () => {
      const { data } = await supabase
        .from("sales_entries")
        .select("employee_id,product_id,data,quantidade,updated_at")
        .eq("data", dayIso);
      return (data ?? []) as Sale[];
    },
  });

  const salesMonthQ = useQuery({
    queryKey: ["sales-month", start, end],
    queryFn: async () => {
      const { data } = await supabase
        .from("sales_entries")
        .select("employee_id,product_id,data,quantidade")
        .gte("data", start).lte("data", end);
      return (data ?? []) as Sale[];
    },
  });

  const weekStart = ymd(new Date(year, month - 1, day - 6));
  const salesWeekQ = useQuery({
    queryKey: ["sales-week", weekStart, dayIso],
    queryFn: async () => {
      const { data } = await supabase
        .from("sales_entries")
        .select("employee_id,product_id,data,quantidade")
        .gte("data", weekStart).lte("data", dayIso);
      return (data ?? []) as Sale[];
    },
  });

  const tDay = sgfQ.data ?? [];
  const allEmployees = opsEmployees;
  const shiftsToday = shiftDayQ.data ?? [];

  const workingIds = new Set(
    shiftsToday
      .filter((s) =>
        !isSalesBlockedShift(s) && (
          s.estado === "trabalha" ||
          (s.estado == null && Number(s.horas ?? 0) > 0)
        ))
      .map((s) => s.employee_id),
  );

  const employees = shiftsToday.length === 0
    ? allEmployees
    : allEmployees.filter((e) => workingIds.has(e.id));
  const products = prodQ.data ?? [];
  const sales = salesQ.data ?? [];

  const totDay = aggregate(tDay);

  const prodMap = useMemo(() => new Map(products.map((p) => [p.id, p])), [products]);

  const catTotals = useMemo(() => {
    const m: Record<string, number> = { "NC": 0, "Alarme": 0, "Móvel": 0, "Marcações": 0, "Energia": 0, "Fixo": 0, "MaisNegocio": 0 };
    for (const s of sales) {
      const p = prodMap.get(s.product_id);
      if (!p) continue;
      const code = (p.codigo ?? "").toLowerCase();
      const q = Number(s.quantidade);
      const w = q * Number(p.peso ?? 0);
      const isRetoma = RETOMA_CODES.has(code);
      if (code === "nc") m["NC"] += q;
      else if (code === "alarmes" || code === "alarme") m["Alarme"] += q;
      else if (MOVEL_CODES.has(code)) m["Móvel"] += w;
      else if (MARCACOES_CODES.has(code)) m["Marcações"] += w;
      else if (code === "energia" || code === "energia-sa") m["Energia"] += q;
      else if (FIXO_CODES.has(code)) m["Fixo"] += w;
      if (isRetoma) m["MaisNegocio"] += w;
      if (!EXCLUDED_FROM_PTS.has(code) && !FIXO_CODES.has(code) && !MOVEL_CODES.has(code) && !MARCACOES_CODES.has(code) && !RETOMA_CODES.has(code)) {
        m["MaisNegocio"] += w;
      }
    }
    return m;
  }, [sales, prodMap]);

  const combinaTotal = useMemo(() => {
    let total = 0;
    for (const s of sales) {
      const p = prodMap.get(s.product_id);
      if (!p) continue;
      if ((p.codigo ?? "").toLowerCase() === "combina") total += Number(s.quantidade);
    }
    return total;
  }, [sales, prodMap]);

  const [combinaOpen, setCombinaOpen] = useState(false);
  const [combinaEmpId, setCombinaEmpId] = useState("");
  const [combinaQty, setCombinaQty] = useState(1);
  const combinaProduct = useMemo(() => products.find((p) => (p.codigo ?? "").toLowerCase() === "combina"), [products]);

  async function saveCombina() {
    if (!combinaProduct) { toast.error("Produto Combina não encontrado."); return; }
    const emp = (empQ.data ?? []).find((e) => e.id === combinaEmpId);
    if (!emp) { toast.error("Escolhe o colaborador."); return; }
    const current = sales
      .filter((s) => s.employee_id === emp.id && s.product_id === combinaProduct.id)
      .reduce((a, s) => a + Number(s.quantidade), 0);
    const next = current + combinaQty;
    const { error } = await supabase.from("sales_entries").upsert(
      { employee_id: emp.id, product_id: combinaProduct.id, data: dayIso, quantidade: next },
      { onConflict: "employee_id,product_id,data" },
    );
    if (error) { toast.error(error.message); return; }
    toast.success(`Combina +${combinaQty} · ${emp.nome}`);
    haptic("tap");
    setCombinaQty(1);
    qc.invalidateQueries({ queryKey: ["sales-day"] });
    qc.invalidateQueries({ queryKey: ["sales-emp-day"] });
  }
  const combinaByEmp = useMemo(() => {
    const everyone = empQ.data ?? [];
    const rows: { emp: string; qty: number }[] = [];
    for (const s of sales) {
      const p = prodMap.get(s.product_id);
      if (!p || (p.codigo ?? "").toLowerCase() !== "combina") continue;
      const emp = everyone.find((e) => e.id === s.employee_id)?.nome ?? "Sem nome";
      rows.push({ emp, qty: Number(s.quantidade) });
    }
    const groups = new Map<string, { qty: number }[]>();
    for (const r of rows) {
      if (!groups.has(r.emp)) groups.set(r.emp, []);
      groups.get(r.emp)!.push({ qty: r.qty });
    }
    return [...groups.entries()].sort((a, b) => b[1].reduce((x, y) => x + y.qty, 0) - a[1].reduce((x, y) => x + y.qty, 0));
  }, [sales, prodMap, empQ.data]);

  const totalGlobal = useMemo(
    () => sales.reduce((a, s) => a + Number(s.quantidade), 0),
    [sales],
  );

  const totalPtsDay = useMemo(() => {
    let pts = 0;
    for (const s of sales) {
      const p = prodMap.get(s.product_id);
      if (!p) continue;
      const code = (p.codigo ?? "").toLowerCase();
      if (code === "migracoes-tv") continue;
      if (EXCLUDED_FROM_PTS.has(code)) continue;
      pts += Number(s.quantidade) * Number(p.peso ?? 0);
    }
    return pts;
  }, [sales, prodMap]);

  const folgaEmpIds = useMemo(() => {
    const s = new Set<string>();
    for (const sh of shiftsToday) {
      const est = (sh.estado ?? "").trim();
      const isFolga = isSalesBlockedShift(sh) || (Number(sh.horas ?? 0) <= 0) || (est !== "" && est !== "trabalha");
      if (isFolga) s.add(sh.employee_id);
    }
    return s;
  }, [shiftsToday]);

  const empRows = useMemo(() => {
    const sgfByEmp = new Map<string, Ticket[]>();
    for (const t of tDay) {
      if (!t.employee_id) continue;
      if (!sgfByEmp.has(t.employee_id)) sgfByEmp.set(t.employee_id, []);
      sgfByEmp.get(t.employee_id)!.push(t);
    }
    const salesByEmp = new Map<string, Sale[]>();
    for (const s of sales) {
      if (!salesByEmp.has(s.employee_id)) salesByEmp.set(s.employee_id, []);
      salesByEmp.get(s.employee_id)!.push(s);
    }
    return employees.map((e) => {
      const ts = sgfByEmp.get(e.id) ?? [];
      const ss = salesByEmp.get(e.id) ?? [];
      const atendidos = ts.filter((x) => x.estado === "terminada").length;
      const aRows = ts.filter((x) => x.atendimento_s && !folgaEmpIds.has(e.id));
      const tma = aRows.reduce((a, r) => a + (r.atendimento_s ?? 0), 0) / (aRows.length || 1);
      let qty = 0, pts = 0, tvs = 0, alarmes = 0, movel = 0, marcacoes = 0, energia = 0, maisNegocio = 0;
      for (const s of ss) {
        const p = prodMap.get(s.product_id);
        if (!p) continue;
        const q = Number(s.quantidade);
        const w = q * Number(p.peso ?? 0);
        const code = (p.codigo ?? "").toLowerCase();
        const n = normalize(p.categoria ?? p.nome);
        const isFixo = code === "tv" || code === "migracoes-tv" || n.includes("tv");
        const isRetoma = RETOMA_CODES.has(code);
        if (isFixo) tvs += q;
        if (code === "migracoes-tv") continue;
        qty += q;
        const isAlarme = code === "alarmes" || code === "alarme" || n.includes("alarme");
        if (isAlarme) alarmes += q;
        const isMovel = MOVEL_CODES.has(code);
        if (isMovel) movel += q;
        const isMarcacoes = MARCACOES_CODES.has(code);
        if (isMarcacoes) marcacoes += q;
        const isEnergia = code === "energia" || code === "energia-sa" || n.includes("energia");
        if (isEnergia) energia += q;
        if (isRetoma) maisNegocio += w;
        if (!EXCLUDED_FROM_PTS.has(code) && !isFixo && !isMovel && !isMarcacoes && !isRetoma) maisNegocio += w;
        if (EXCLUDED_FROM_PTS.has(code)) continue;
        pts += w;
      }
      const tep = atendidos > 0 ? (pts / atendidos) * 100 : 0;
      return { e, atendidos, tma, qty, pts, tvs, alarmes, movel, marcacoes, energia, maisNegocio, tep };
    }).sort((a, b) => b.pts - a.pts || b.qty - a.qty);
  }, [employees, tDay, sales, prodMap, folgaEmpIds]);
