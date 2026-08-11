import { Fragment, useMemo, useRef, useState, type ReactNode } from "react";
import {
  buildResultWorkbook,
  buildUpdatedBase,
  downloadBlob,
  parseRawFile,
  parseRulesBase,
  processRows,
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

export default function App() {
  const [baseFile, setBaseFile] = useState<File | null>(null);
  const [rawFile, setRawFile] = useState<File | null>(null);
  const [rules, setRules] = useState<RulesMap | null>(null);
  const [result, setResult] = useState<ProcessResult | null>(null);
  const [decisions, setDecisions] = useState<Map<string, boolean>>(new Map());
  const [tab, setTab] = useState<"marcados" | "normais" | "pendentes">("pendentes");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const totals = useMemo(() => {
    if (!result) return null;
    const sum = (arr: { contabil: number; icms: number }[]) =>
      arr.reduce((acc, g) => ({ contabil: acc.contabil + g.contabil, icms: acc.icms + g.icms }), { contabil: 0, icms: 0 });
    return {
      marcados: sum(result.marcados),
      normais: sum(result.normais),
      pendentes: sum(result.pendentes),
    };
  }, [result]);

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
    if (!result) return;
    const blob = await buildResultWorkbook(result, decisions);
    downloadBlob(blob, "Resultado_Processado.xlsx");
  }

  async function handleDownloadUpdatedBase() {
    if (!result || !rules) return;
    const blob = await buildUpdatedBase(rules, result.pendentes, decisions);
    downloadBlob(blob, "Base_Regras_Atualizada.xlsx");
  }

  const decidedCount = decisions.size;

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
            regra (alíquota zero ou normal) e devolve os pendentes para você classificar.
          </p>

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

        {result && totals && (
          <section className="mt-8">
            <div className="flex flex-wrap gap-4 mb-6">
              <SummaryCard
                label="Marcados · alíquota zero"
                count={result.marcados.length}
                contabil={totals.marcados.contabil}
                icms={totals.marcados.icms}
                accent={GOLD}
              />
              <SummaryCard
                label="Conhecidos · normais"
                count={result.normais.length}
                contabil={totals.normais.contabil}
                icms={totals.normais.icms}
                accent={NAVY}
              />
              <SummaryCard
                label="Pendentes reais"
                count={result.pendentes.length}
                contabil={totals.pendentes.contabil}
                icms={totals.pendentes.icms}
                accent="#e11d48"
              />
            </div>

            <div className="bg-white rounded-2xl shadow-xl overflow-hidden">
              <div className="flex gap-1 px-4 pt-4 border-b border-slate-100">
                <TabButton active={tab === "pendentes"} onClick={() => setTab("pendentes")}>
                  Pendentes ({result.pendentes.length})
                </TabButton>
                <TabButton active={tab === "marcados"} onClick={() => setTab("marcados")}>
                  Marcados ({result.marcados.length})
                </TabButton>
                <TabButton active={tab === "normais"} onClick={() => setTab("normais")}>
                  Conhecidos-Normais ({result.normais.length})
                </TabButton>
              </div>

              <div className="p-4">
                {tab === "pendentes" && (
                  <div className="overflow-x-auto rounded-xl border border-slate-100">
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
                        {result.pendentes.map((p) => {
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
                                    Normal
                                  </button>
                                </div>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                    {result.pendentes.length === 0 && (
                      <p className="px-3 py-6 text-center text-slate-400">Nenhuma pendência — tudo já está na base.</p>
                    )}
                  </div>
                )}

                {tab === "marcados" && <GroupTable groups={result.marcados} highlight />}
                {tab === "normais" && <GroupTable groups={result.normais} />}
              </div>

              <div className="p-6 bg-slate-50 flex flex-wrap gap-3 border-t border-slate-100">
                <button
                  onClick={handleDownloadResult}
                  className="flex items-center gap-2 px-6 py-3 bg-white border border-slate-200 text-slate-700 rounded-xl font-semibold hover:bg-slate-100 transition-all active:scale-95"
                >
                  Baixar resultado processado
                </button>
                <button
                  onClick={handleDownloadUpdatedBase}
                  disabled={decidedCount === 0}
                  className="flex items-center gap-2 px-6 py-3 text-white rounded-xl font-semibold transition-all active:scale-95 disabled:opacity-40 disabled:grayscale"
                  style={{ background: NAVY }}
                >
                  Baixar base atualizada ({decidedCount} nova(s) regra(s))
                </button>
              </div>
            </div>
          </section>
        )}
      </main>

      <footer className="p-8 text-center" style={{ background: NAVY }}>
        <img src="/simbolo.png" alt="Contador de Padarias" className="h-8 object-contain mx-auto opacity-70" />
      </footer>
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

function GroupTable({ groups, highlight }: { groups: ProcessResult["marcados"]; highlight?: boolean }) {
  return (
    <div className="overflow-x-auto rounded-xl border border-slate-100">
      <table className="w-full text-sm">
        <thead className="bg-slate-50 text-slate-500">
          <tr>
            <th className="text-left px-3 py-2 font-semibold">NCM / Item</th>
            <th className="text-right px-3 py-2 font-semibold">Valor Contábil</th>
            <th className="text-right px-3 py-2 font-semibold">Valor ICMS</th>
          </tr>
        </thead>
        <tbody>
          {groups.map((g) => (
            <Fragment key={g.ncm}>
              <tr className="border-t border-slate-100 font-semibold" style={highlight ? { background: "rgba(240,180,41,0.25)" } : { background: "#f8fafc" }}>
                <td className="px-3 py-2 text-slate-800">{g.ncm}</td>
                <td className="px-3 py-2 text-right text-slate-800">{money(g.contabil)}</td>
                <td className="px-3 py-2 text-right text-slate-800">{money(g.icms)}</td>
              </tr>
              {g.items.map((it) => (
                <tr key={g.ncm + it.item} className="border-t border-slate-50">
                  <td className="px-3 py-2 pl-8 text-slate-600">{it.item}</td>
                  <td className="px-3 py-2 text-right text-slate-500">{money(it.contabil)}</td>
                  <td className="px-3 py-2 text-right text-slate-500">{money(it.icms)}</td>
                </tr>
              ))}
            </Fragment>
          ))}
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
