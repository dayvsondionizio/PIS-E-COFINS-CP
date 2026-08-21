import { Fragment, useMemo, useRef, useState, type ReactNode } from "react";
import {
  applyDecisions,
  buildResultWorkbook,
  buildUpdatedBase,
  downloadBlob,
  parseRawFile,
  parseRulesBase,
  processRows,
  type Group,
  type ProcessResult,
  type RulesMap,
} from "./lib/rules";

const NAVY = "#020D2F";
const GOLD = "#F0B429";

function money(n: number) {
  return n.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function normKey(ncm: string, item: string) {
  return `${ncm.trim().toUpperCase()}|${item.trim().toUpperCase()}`;
}

function slugFilePart(s: string) {
  return s
    .trim()
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/[^a-zA-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function buildFileName(base: string, empresa: string, competencia: string) {
  const parts = [base, slugFilePart(empresa), slugFilePart(competencia)].filter(Boolean);
  return `${parts.join("_")}.xlsx`;
}

function pad2(n: number) {
  return String(n).padStart(2, "0");
}

function buildTimestampedFileName(base: string) {
  const now = new Date();
  const data = `${pad2(now.getDate())}-${pad2(now.getMonth() + 1)}-${now.getFullYear()}`;
  const hora = `${pad2(now.getHours())}-${pad2(now.getMinutes())}`;
  return `${base}_${data}_${hora}.xlsx`;
}

export default function App() {
  const [baseFile, setBaseFile] = useState<File | null>(null);
  const [rawFile, setRawFile] = useState<File | null>(null);
  const [rules, setRules] = useState<RulesMap | null>(null);
  const [result, setResult] = useState<ProcessResult | null>(null);
  const [decisions, setDecisions] = useState<Map<string, boolean>>(new Map());
  const [tab, setTab] = useState<"marcados" | "normais" | "pendentes" | "completo">("pendentes");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState("");
  const [empresa, setEmpresa] = useState("");
  const [competencia, setCompetencia] = useState("");
  const [pendentesPage, setPendentesPage] = useState(1);

  const searchNorm = search.trim().toUpperCase();
  const PENDENTES_PAGE_SIZE = 200;

  const displayResult = useMemo(() => (result ? applyDecisions(result, decisions) : null), [result, decisions]);

  const combinedGroups = useMemo((): (Group & { highlight: boolean })[] => {
    if (!displayResult) return [];
    return [
      ...displayResult.marcados.map((g) => ({ ...g, highlight: true })),
      ...displayResult.normais.map((g) => ({ ...g, highlight: false })),
    ].sort((a, b) => a.ncm.localeCompare(b.ncm));
  }, [displayResult]);

  const filteredPendentes = useMemo(() => {
    if (!displayResult) return [];
    if (!searchNorm) return displayResult.pendentes;
    return displayResult.pendentes.filter(
      (p) => p.ncm.toUpperCase().includes(searchNorm) || p.item.toUpperCase().includes(searchNorm)
    );
  }, [displayResult, searchNorm]);

  const pendentesTotalPages = Math.max(1, Math.ceil(filteredPendentes.length / PENDENTES_PAGE_SIZE));
  const pendentesCurrentPage = Math.min(pendentesPage, pendentesTotalPages);
  const pagedPendentes = useMemo(
    () =>
      filteredPendentes.slice(
        (pendentesCurrentPage - 1) * PENDENTES_PAGE_SIZE,
        pendentesCurrentPage * PENDENTES_PAGE_SIZE
      ),
    [filteredPendentes, pendentesCurrentPage]
  );

  function filterGroups<T extends { ncm: string; items: { item: string }[] }>(groups: T[]): T[] {
    if (!searchNorm) return groups;
    return groups
      .map((g) => {
        if (g.ncm.toUpperCase().includes(searchNorm)) return g;
        const items = g.items.filter((it) => it.item.toUpperCase().includes(searchNorm));
        if (items.length === 0) return null;
        return { ...g, items };
      })
      .filter((g): g is T => g !== null);
  }

  const filteredMarcados = useMemo(
    () => filterGroups(displayResult?.marcados ?? []),
    [displayResult, searchNorm]
  );
  const filteredNormais = useMemo(
    () => filterGroups(displayResult?.normais ?? []),
    [displayResult, searchNorm]
  );
  const filteredCombined = useMemo(() => filterGroups(combinedGroups), [combinedGroups, searchNorm]);

  const totals = useMemo(() => {
    if (!displayResult) return null;
    const sum = (arr: { contabil: number; icms: number }[]) =>
      arr.reduce((acc, g) => ({ contabil: acc.contabil + g.contabil, icms: acc.icms + g.icms }), { contabil: 0, icms: 0 });
    return {
      marcados: sum(displayResult.marcados),
      normais: sum(displayResult.normais),
      pendentes: sum(displayResult.pendentes),
    };
  }, [displayResult]);

  async function handleProcess() {
    if (!baseFile || !rawFile) return;
    setError(null);
    setLoading(true);
    try {
      const parsedRules = await parseRulesBase(baseFile);
      const rawRows = await parseRawFile(rawFile);
      const processed = processRows(rawRows, parsedRules);
      setRules(parsedRules);
      setResult(processed);
      setDecisions(new Map());
      setTab(processed.pendentes.length > 0 ? "pendentes" : "marcados");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erro ao processar os arquivos.");
    } finally {
      setLoading(false);
    }
  }

  function setDecision(ncm: string, item: string, value: boolean | undefined) {
    setDecisions((prev) => {
      const next = new Map(prev);
      const k = normKey(ncm, item);
      if (value === undefined) next.delete(k);
      else next.set(k, value);
      return next;
    });
  }

  async function handleDownloadResult() {
    if (!displayResult) return;
    const blob = await buildResultWorkbook(displayResult);
    downloadBlob(blob, buildFileName("Resultado_Processado", empresa, competencia));
  }

  async function handleDownloadUpdatedBase() {
    if (!result || !rules) return;
    const blob = await buildUpdatedBase(rules, result.pendentes, decisions);
    downloadBlob(blob, buildTimestampedFileName("Base_Regras_Atualizada"));
  }

  const decidedCount = decisions.size;
  const [showResetConfirm, setShowResetConfirm] = useState(false);

  function handleReset() {
    setBaseFile(null);
    setRawFile(null);
    setRules(null);
    setResult(null);
    setDecisions(new Map());
    setTab("pendentes");
    setError(null);
    setEmpresa("");
    setCompetencia("");
    setShowResetConfirm(false);
  }

  return (
    <div
      className="min-h-screen flex flex-col font-sans text-slate-900"
      style={{ background: "#f7f5ef" }}
    >
      {/* Header */}
      <header className="text-white relative" style={{ background: NAVY, boxShadow: "0 12px 32px -12px rgba(2,13,47,0.45)" }}>
        <div
          className="absolute inset-x-0 bottom-0 h-[3px]"
          style={{ background: `linear-gradient(90deg, transparent, ${GOLD} 20%, ${GOLD} 80%, transparent)` }}
        />
        <div className="max-w-5xl mx-auto px-6 pt-8 pb-14 flex items-center gap-5">
          <img src="/logo.png" alt="Contador de Padarias" className="h-16 object-contain" />
          <div className="hidden md:block w-px h-12 bg-white/15" />
          <div>
            <h1 className="font-serif text-3xl font-semibold tracking-tight text-white mb-0.5">NCM Alíquota Zero</h1>
            <p className="font-medium text-[0.95rem]" style={{ color: "rgba(240,180,41,0.8)" }}>
              Classificação automática de PIS/COFINS por NCM + Item
            </p>
          </div>
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-6 -mt-8 relative z-10 flex-1 w-full pb-12">
        <div className="bg-white rounded-2xl shadow-2xl p-8 md:p-10">
          <p className="text-slate-500 text-sm mb-6 max-w-2xl">
            Envie a base de regras já conhecida e a planilha do período. O app cruza NCM + Item, separa o que já tem
            regra (alíquota zero ou tributado) e devolve os pendentes para você classificar.
          </p>

          <div className="grid md:grid-cols-2 gap-5 mb-6">
            <div>
              <label className="block text-xs font-bold text-slate-500 uppercase tracking-wide mb-1.5">
                Nome da empresa
              </label>
              <input
                type="text"
                value={empresa}
                onChange={(e) => setEmpresa(e.target.value)}
                placeholder="Ex: Gugel, Vila Amizade Matriz..."
                className="w-full rounded-xl border border-slate-200 px-4 py-2.5 text-sm focus:outline-none"
                style={{ boxShadow: empresa ? `0 0 0 2px rgba(240,180,41,0.3)` : undefined }}
              />
            </div>
            <div>
              <label className="block text-xs font-bold text-slate-500 uppercase tracking-wide mb-1.5">
                Mês de competência
              </label>
              <input
                type="text"
                value={competencia}
                onChange={(e) => setCompetencia(e.target.value)}
                placeholder="Ex: 01-2026"
                className="w-full rounded-xl border border-slate-200 px-4 py-2.5 text-sm focus:outline-none"
                style={{ boxShadow: competencia ? `0 0 0 2px rgba(240,180,41,0.3)` : undefined }}
              />
            </div>
          </div>

          <div className="grid md:grid-cols-2 gap-5 mb-6">
            <FileDrop
              step="1"
              label="Base de Regras"
              hint="Colunas: NCM, Item, Alíquota Zero (Amarelo)"
              file={baseFile}
              onSelect={setBaseFile}
            />
            <FileDrop
              step="2"
              label="Planilha do período"
              hint="Colunas: NCM, Item, Valor Contábil, Valor ICMS"
              file={rawFile}
              onSelect={setRawFile}
            />
          </div>

          <div className="flex flex-col items-center">
            <button
              onClick={handleProcess}
              disabled={!baseFile || !rawFile || loading}
              className="flex items-center gap-3 px-10 py-4 text-white rounded-xl font-bold transition-all active:scale-95 hover:scale-[1.02] shadow-xl disabled:opacity-40 disabled:grayscale disabled:hover:scale-100"
              style={{ background: NAVY }}
            >
              {loading ? "Processando..." : "Processar planilha"}
            </button>
          </div>

          {error && (
            <p className="mt-4 text-rose-700 text-sm border border-rose-200 bg-rose-50 rounded-xl px-4 py-3">{error}</p>
          )}
        </div>

        {displayResult && totals && (
          <section className="mt-8">
            <div className="flex justify-end mb-4">
              <button
                onClick={() => setShowResetConfirm(true)}
                className="flex items-center gap-2 px-4 py-2 text-sm font-semibold text-rose-700 border border-rose-200 bg-rose-50 rounded-xl hover:bg-rose-100 transition-all active:scale-95"
              >
                Nova apuração (limpar dados)
              </button>
            </div>
            <div className="flex flex-wrap gap-4 mb-6">
              <SummaryCard
                label="Marcados · alíquota zero"
                count={displayResult.marcados.length}
                contabil={totals.marcados.contabil}
                icms={totals.marcados.icms}
                accent={GOLD}
              />
              <SummaryCard
                label="Conhecidos · tributado"
                count={displayResult.normais.length}
                contabil={totals.normais.contabil}
                icms={totals.normais.icms}
                accent={NAVY}
              />
              <SummaryCard
                label="Pendentes reais"
                count={displayResult.pendentes.length}
                contabil={totals.pendentes.contabil}
                icms={totals.pendentes.icms}
                accent="#e11d48"
              />
            </div>

            <div className="bg-white rounded-2xl shadow-xl overflow-hidden">
              <div className="flex flex-wrap items-center gap-3 px-4 pt-4">
                <input
                  type="text"
                  value={search}
                  onChange={(e) => {
                    setSearch(e.target.value);
                    setPendentesPage(1);
                  }}
                  placeholder="Pesquisar por NCM ou nome do item..."
                  className="flex-1 min-w-[220px] rounded-xl border border-slate-200 px-4 py-2 text-sm focus:outline-none focus:ring-2"
                  style={{ boxShadow: search ? `0 0 0 2px rgba(240,180,41,0.3)` : undefined }}
                />
                {search && (
                  <button
                    onClick={() => {
                      setSearch("");
                      setPendentesPage(1);
                    }}
                    className="text-xs font-semibold text-slate-500 hover:text-slate-700 px-2 py-1"
                  >
                    Limpar busca
                  </button>
                )}
              </div>
              <div className="flex gap-1 px-4 pt-3 border-b border-slate-100">
                <TabButton active={tab === "pendentes"} onClick={() => setTab("pendentes")}>
                  Pendentes ({filteredPendentes.length})
                </TabButton>
                <TabButton active={tab === "completo"} onClick={() => setTab("completo")}>
                  Completo ({filteredCombined.length})
                </TabButton>
                <TabButton active={tab === "marcados"} onClick={() => setTab("marcados")}>
                  Marcados ({filteredMarcados.length})
                </TabButton>
                <TabButton active={tab === "normais"} onClick={() => setTab("normais")}>
                  Conhecidos-Tributado ({filteredNormais.length})
                </TabButton>
              </div>

              <div className="p-4">
                {tab === "pendentes" && (
                  <div className="overflow-x-auto rounded-xl border border-slate-100">
                    {filteredPendentes.length > 0 && (
                      <div className="flex items-center justify-between px-3 py-2 border-b border-slate-100 bg-slate-50/60 text-xs text-slate-500">
                        <span>
                          Mostrando {(pendentesCurrentPage - 1) * PENDENTES_PAGE_SIZE + 1}–
                          {Math.min(pendentesCurrentPage * PENDENTES_PAGE_SIZE, filteredPendentes.length)} de{" "}
                          {filteredPendentes.length}
                        </span>
                        <div className="flex items-center gap-2">
                          <button
                            onClick={() => setPendentesPage((p) => Math.max(1, p - 1))}
                            disabled={pendentesCurrentPage <= 1}
                            className="font-semibold px-2 py-1 rounded disabled:opacity-30 hover:bg-slate-200 transition"
                          >
                            ← Anterior
                          </button>
                          <span className="font-semibold">
                            Página {pendentesCurrentPage} de {pendentesTotalPages}
                          </span>
                          <button
                            onClick={() => setPendentesPage((p) => Math.min(pendentesTotalPages, p + 1))}
                            disabled={pendentesCurrentPage >= pendentesTotalPages}
                            className="font-semibold px-2 py-1 rounded disabled:opacity-30 hover:bg-slate-200 transition"
                          >
                            Próxima →
                          </button>
                        </div>
                      </div>
                    )}
                    <table className="w-full text-sm">
                      <thead className="bg-slate-50 text-slate-500">
                        <tr>
                          <th className="text-left px-3 py-2 font-semibold">NCM</th>
                          <th className="text-left px-3 py-2 font-semibold">Item</th>
                          <th className="text-right px-3 py-2 font-semibold">Valor Contábil</th>
                          <th className="text-right px-3 py-2 font-semibold">Valor ICMS</th>
                          <th className="text-center px-3 py-2 font-semibold">Classificar</th>
                        </tr>
                      </thead>
                      <tbody>
                        {pagedPendentes.map((p) => {
                          const k = normKey(p.ncm, p.item);
                          const decision = decisions.get(k);
                          return (
                            <tr key={k} className="border-t border-slate-100">
                              <td className="px-3 py-2 whitespace-nowrap text-slate-700">{p.ncm}</td>
                              <td className="px-3 py-2 text-slate-700">{p.item}</td>
                              <td className="px-3 py-2 text-right text-slate-600">{money(p.contabil)}</td>
                              <td className="px-3 py-2 text-right text-slate-600">{money(p.icms)}</td>
                              <td className="px-3 py-2">
                                <div className="flex justify-center gap-1">
                                  <button
                                    onClick={() => setDecision(p.ncm, p.item, true)}
                                    className="px-2.5 py-1 rounded-full text-xs font-semibold transition"
                                    style={
                                      decision === true
                                        ? { background: GOLD, color: NAVY }
                                        : { background: "#f1f5f9", color: "#64748b" }
                                    }
                                  >
                                    Alíquota zero
                                  </button>
                                  <button
                                    onClick={() => setDecision(p.ncm, p.item, false)}
                                    className="px-2.5 py-1 rounded-full text-xs font-semibold transition"
                                    style={
                                      decision === false
                                        ? { background: NAVY, color: "#fff" }
                                        : { background: "#f1f5f9", color: "#64748b" }
                                    }
                                  >
                                    Tributado
                                  </button>
                                </div>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                    {filteredPendentes.length === 0 && (
                      <p className="px-3 py-6 text-center text-slate-400">
                        {search ? "Nenhum resultado para essa busca." : "Nenhuma pendência — tudo já está na base."}
                      </p>
                    )}
                  </div>
                )}

                {tab === "completo" && (
                  <GroupTable
                    key={`completo-${searchNorm}`}
                    groups={filteredCombined}
                    highlight={(g) => g.highlight}
                    decisions={decisions}
                    onUndo={(ncm, item) => setDecision(ncm, item, undefined)}
                    onSwitch={(ncm, item, value) => setDecision(ncm, item, value)}
                  />
                )}
                {tab === "marcados" && (
                  <GroupTable
                    key={`marcados-${searchNorm}`}
                    groups={filteredMarcados}
                    highlight
                    decisions={decisions}
                    onUndo={(ncm, item) => setDecision(ncm, item, undefined)}
                    onSwitch={(ncm, item, value) => setDecision(ncm, item, value)}
                  />
                )}
                {tab === "normais" && (
                  <GroupTable
                    key={`normais-${searchNorm}`}
                    groups={filteredNormais}
                    decisions={decisions}
                    onUndo={(ncm, item) => setDecision(ncm, item, undefined)}
                    onSwitch={(ncm, item, value) => setDecision(ncm, item, value)}
                  />
                )}
              </div>

              <div className="p-6 bg-slate-50 flex flex-wrap gap-3 border-t border-slate-100">
                <div>
                  <button
                    onClick={handleDownloadResult}
                    className="flex items-center gap-2 px-6 py-3 bg-white border border-slate-200 text-slate-700 rounded-xl font-semibold hover:bg-slate-100 transition-all active:scale-95"
                  >
                    Baixar resultado processado
                  </button>
                  <p className="text-[11px] text-slate-400 mt-1 pl-1">{buildFileName("Resultado_Processado", empresa, competencia)}</p>
                </div>
                <div>
                  <button
                    onClick={handleDownloadUpdatedBase}
                    disabled={decidedCount === 0}
                    className="flex items-center gap-2 px-6 py-3 text-white rounded-xl font-semibold transition-all active:scale-95 disabled:opacity-40 disabled:grayscale"
                    style={{ background: NAVY }}
                  >
                    Baixar base atualizada ({decidedCount} nova(s) regra(s))
                  </button>
                  <p className="text-[11px] text-slate-400 mt-1 pl-1">{buildTimestampedFileName("Base_Regras_Atualizada")}</p>
                </div>
              </div>
            </div>
          </section>
        )}
      </main>

      <footer className="p-8 text-center" style={{ background: NAVY }}>
        <img src="/simbolo.png" alt="Contador de Padarias" className="h-8 object-contain mx-auto opacity-70" />
      </footer>

      {showResetConfirm && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
          style={{ background: "rgba(2,13,47,0.55)" }}
          onClick={() => setShowResetConfirm(false)}
        >
          <div
            className="bg-white rounded-2xl shadow-2xl max-w-md w-full p-6"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 className="font-serif text-xl font-semibold text-slate-900 mb-2">Você já baixou os arquivos?</h2>
            <p className="text-sm text-slate-600 mb-1">
              "Nova apuração" apaga tudo da tela — planilhas, classificações e resultado. Nada fica salvo em
              lugar nenhum.
            </p>
            {decidedCount > 0 && (
              <p className="text-sm font-semibold rounded-xl px-3 py-2 mt-3" style={{ background: "rgba(240,180,41,0.15)", color: "#8a6412" }}>
                Você classificou {decidedCount} pendente(s) e ainda não baixou a base atualizada — essas
                regras novas serão perdidas se continuar sem baixar.
              </p>
            )}
            <div className="flex justify-end gap-3 mt-6">
              <button
                onClick={() => setShowResetConfirm(false)}
                className="px-5 py-2.5 rounded-xl font-semibold text-sm bg-slate-100 text-slate-700 hover:bg-slate-200 transition"
              >
                Cancelar, quero baixar antes
              </button>
              <button
                onClick={handleReset}
                className="px-5 py-2.5 rounded-xl font-semibold text-sm text-white bg-rose-600 hover:bg-rose-700 transition"
              >
                Já baixei, limpar tudo
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function FileDrop({
  step,
  label,
  hint,
  file,
  onSelect,
}: {
  step: string;
  label: string;
  hint: string;
  file: File | null;
  onSelect: (f: File) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = useState(false);

  function handleFile(f: File | undefined) {
    if (f) onSelect(f);
  }

  return (
    <div
      onClick={() => inputRef.current?.click()}
      onDragOver={(e) => {
        e.preventDefault();
        setDragOver(true);
      }}
      onDragLeave={() => setDragOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDragOver(false);
        handleFile(e.dataTransfer.files?.[0]);
      }}
      className="relative group border-2 border-dashed rounded-2xl p-6 cursor-pointer transition-all"
      style={{
        borderColor: dragOver ? GOLD : "#e2e8f0",
        background: dragOver ? "rgba(240,180,41,0.06)" : "#fff",
      }}
    >
      <div className="flex items-center gap-2 mb-1">
        <span
          className="w-5 h-5 rounded-full flex items-center justify-center text-[11px] font-bold text-white shrink-0"
          style={{ background: NAVY }}
        >
          {step}
        </span>
        <span className="font-bold text-slate-800">{label}</span>
      </div>
      <p className="text-slate-500 text-xs mb-3 pl-7">{hint}</p>
      <input
        ref={inputRef}
        type="file"
        accept=".xlsx,.xls"
        className="hidden"
        onChange={(e) => handleFile(e.target.files?.[0])}
      />
      <span
        className="inline-block ml-7 text-xs font-medium rounded-full px-3 py-1"
        style={file ? { background: "rgba(240,180,41,0.15)", color: "#8a6412" } : { background: "#f1f5f9", color: "#64748b" }}
      >
        {file ? file.name : "Selecionar arquivo..."}
      </span>
    </div>
  );
}

function SummaryCard({
  label,
  count,
  contabil,
  icms,
  accent,
}: {
  label: string;
  count: number;
  contabil: number;
  icms: number;
  accent: string;
}) {
  return (
    <div className="rounded-2xl px-5 py-4 min-w-[220px] flex-1 bg-white shadow-md border-l-4" style={{ borderLeftColor: accent }}>
      <p className="text-xs uppercase tracking-wide text-slate-400 font-semibold">{label}</p>
      <p className="text-xl font-bold text-slate-800">{count} NCM</p>
      <p className="text-xs text-slate-500">Contábil: R$ {money(contabil)}</p>
      <p className="text-xs text-slate-500">ICMS: R$ {money(icms)}</p>
    </div>
  );
}

function TabButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      onClick={onClick}
      className="px-4 py-2.5 text-sm font-semibold -mb-px border-b-2 transition"
      style={active ? { borderColor: GOLD, color: NAVY } : { borderColor: "transparent", color: "#94a3b8" }}
    >
      {children}
    </button>
  );
}

function GroupTable<T extends Group>({
  groups,
  highlight,
  decisions,
  onUndo,
  onSwitch,
}: {
  groups: T[];
  highlight?: boolean | ((g: T) => boolean);
  decisions?: Map<string, boolean>;
  onUndo?: (ncm: string, item: string) => void;
  onSwitch?: (ncm: string, item: string, value: boolean) => void;
}) {
  // Começa tudo recolhido: com milhares de itens, expandir tudo de cara travava o navegador.
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set(groups.map((g) => g.ncm)));
  const [page, setPage] = useState(1);
  const PAGE_SIZE = 100;
  const isHighlighted = (g: T) => (typeof highlight === "function" ? highlight(g) : !!highlight);

  function toggle(ncm: string) {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(ncm)) next.delete(ncm);
      else next.add(ncm);
      return next;
    });
  }

  const allCollapsed = groups.length > 0 && groups.every((g) => collapsed.has(g.ncm));
  const totalPages = Math.max(1, Math.ceil(groups.length / PAGE_SIZE));
  const currentPage = Math.min(page, totalPages);
  const pageGroups = groups.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);

  return (
    <div className="overflow-x-auto rounded-xl border border-slate-100">
      {groups.length > 0 && (
        <div className="flex items-center justify-between px-3 py-2 border-b border-slate-100 bg-slate-50/60 text-xs text-slate-500">
          <span>
            Mostrando {(currentPage - 1) * PAGE_SIZE + 1}–{Math.min(currentPage * PAGE_SIZE, groups.length)} de{" "}
            {groups.length} NCM
          </span>
          <div className="flex items-center gap-3">
            {totalPages > 1 && (
              <>
                <button
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                  disabled={currentPage <= 1}
                  className="font-semibold px-2 py-1 rounded disabled:opacity-30 hover:bg-slate-200 transition"
                >
                  ← Anterior
                </button>
                <span className="font-semibold">
                  Página {currentPage} de {totalPages}
                </span>
                <button
                  onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                  disabled={currentPage >= totalPages}
                  className="font-semibold px-2 py-1 rounded disabled:opacity-30 hover:bg-slate-200 transition"
                >
                  Próxima →
                </button>
              </>
            )}
            <button
              onClick={() => setCollapsed(allCollapsed ? new Set() : new Set(groups.map((g) => g.ncm)))}
              className="font-semibold hover:text-slate-700"
            >
              {allCollapsed ? "Expandir tudo" : "Recolher tudo"}
            </button>
          </div>
        </div>
      )}
      <table className="w-full text-sm">
        <thead className="bg-slate-50 text-slate-500">
          <tr>
            <th className="text-left px-3 py-2 font-semibold">NCM / Item</th>
            <th className="text-right px-3 py-2 font-semibold">Valor Contábil</th>
            <th className="text-right px-3 py-2 font-semibold">Valor ICMS</th>
          </tr>
        </thead>
        <tbody>
          {pageGroups.map((g) => {
            const isCollapsed = collapsed.has(g.ncm);
            return (
              <Fragment key={g.ncm}>
                <tr
                  onClick={() => toggle(g.ncm)}
                  className="border-t border-slate-100 font-semibold cursor-pointer select-none"
                  style={isHighlighted(g) ? { background: "rgba(240,180,41,0.25)" } : { background: "#f8fafc" }}
                >
                  <td className="px-3 py-2 text-slate-800">
                    <span className="inline-flex items-center gap-2">
                      <span
                        className="inline-flex items-center justify-center w-5 h-5 rounded-full text-[10px] bg-white/70 text-slate-600 shrink-0"
                        aria-hidden
                      >
                        {isCollapsed ? "▸" : "▾"}
                      </span>
                      {g.ncm}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-right text-slate-800">{money(g.contabil)}</td>
                  <td className="px-3 py-2 text-right text-slate-800">{money(g.icms)}</td>
                </tr>
                {!isCollapsed &&
                  g.items.map((it) => {
                    const decided = decisions?.get(normKey(g.ncm, it.item));
                    return (
                      <tr key={g.ncm + it.item} className="border-t border-slate-50">
                        <td className="px-3 py-2 pl-10 text-slate-600">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span>{it.item}</span>
                            {decided !== undefined && onUndo && onSwitch && (
                              <span className="flex items-center gap-1">
                                <button
                                  onClick={() => onSwitch(g.ncm, it.item, !decided)}
                                  className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-slate-100 text-slate-500 hover:bg-slate-200 transition"
                                  title="Trocar classificação sem passar por Pendentes"
                                >
                                  Mover p/ {decided ? "Tributado" : "Alíquota zero"}
                                </button>
                                <button
                                  onClick={() => onUndo(g.ncm, it.item)}
                                  className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-rose-50 text-rose-600 hover:bg-rose-100 transition"
                                  title="Volta para Pendentes"
                                >
                                  Desfazer
                                </button>
                              </span>
                            )}
                          </div>
                        </td>
                        <td className="px-3 py-2 text-right text-slate-500">{money(it.contabil)}</td>
                        <td className="px-3 py-2 text-right text-slate-500">{money(it.icms)}</td>
                      </tr>
                    );
                  })}
              </Fragment>
            );
          })}
          {groups.length === 0 && (
            <tr>
              <td colSpan={3} className="px-3 py-6 text-center text-slate-400">
                Nada aqui.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
