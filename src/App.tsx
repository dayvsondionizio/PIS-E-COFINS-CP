import { Fragment, useMemo, useState, type ReactNode } from "react";
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
    <div className="min-h-screen bg-neutral-950 text-neutral-100">
      <div className="max-w-5xl mx-auto px-6 py-10">
        <header className="mb-8">
          <h1 className="text-2xl font-semibold">NCM Alíquota Zero</h1>
          <p className="text-neutral-400 mt-1">
            Envie a base de regras e a planilha de PIS/COFINS. O app marca os NCM+Item já conhecidos e devolve os
            pendentes para você classificar.
          </p>
        </header>

        <section className="grid md:grid-cols-2 gap-4 mb-6">
          <FileDrop
            label="1. Base de Regras (NCM + Item)"
            hint="Arquivo com colunas NCM, Item, Alíquota Zero (Amarelo)"
            file={baseFile}
            onSelect={setBaseFile}
          />
          <FileDrop
            label="2. Planilha para processar"
            hint="Arquivo com colunas NCM, Item, Valor Contábil, Valor ICMS"
            file={rawFile}
            onSelect={setRawFile}
          />
        </section>

        <button
          onClick={handleProcess}
          disabled={!baseFile || !rawFile || loading}
          className="rounded-lg bg-amber-400 text-neutral-950 font-medium px-5 py-2.5 disabled:opacity-40 disabled:cursor-not-allowed hover:bg-amber-300 transition"
        >
          {loading ? "Processando..." : "Processar"}
        </button>

        {error && (
          <p className="mt-4 text-red-400 text-sm border border-red-900 bg-red-950/40 rounded-lg px-4 py-3">{error}</p>
        )}

        {result && totals && (
          <section className="mt-10">
            <div className="flex flex-wrap gap-3 mb-6">
              <SummaryCard
                label="Marcados (alíquota zero)"
                count={result.marcados.length}
                contabil={totals.marcados.contabil}
                icms={totals.marcados.icms}
                color="bg-yellow-400 text-neutral-950"
              />
              <SummaryCard
                label="Conhecidos - normais"
                count={result.normais.length}
                contabil={totals.normais.contabil}
                icms={totals.normais.icms}
                color="bg-neutral-800 text-neutral-100"
              />
              <SummaryCard
                label="Pendentes reais"
                count={result.pendentes.length}
                contabil={totals.pendentes.contabil}
                icms={totals.pendentes.icms}
                color="bg-rose-950 text-rose-200 border border-rose-800"
              />
            </div>

            <div className="flex gap-2 mb-4 border-b border-neutral-800">
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

            {tab === "pendentes" && (
              <div className="overflow-x-auto rounded-lg border border-neutral-800">
                <table className="w-full text-sm">
                  <thead className="bg-neutral-900 text-neutral-400">
                    <tr>
                      <th className="text-left px-3 py-2">NCM</th>
                      <th className="text-left px-3 py-2">Item</th>
                      <th className="text-right px-3 py-2">Valor Contábil</th>
                      <th className="text-right px-3 py-2">Valor ICMS</th>
                      <th className="text-center px-3 py-2">Classificar</th>
                    </tr>
                  </thead>
                  <tbody>
                    {result.pendentes.map((p) => {
                      const k = normKey(p.ncm, p.item);
                      const decision = decisions.get(k);
                      return (
                        <tr key={k} className="border-t border-neutral-800">
                          <td className="px-3 py-2 whitespace-nowrap">{p.ncm}</td>
                          <td className="px-3 py-2">{p.item}</td>
                          <td className="px-3 py-2 text-right">{money(p.contabil)}</td>
                          <td className="px-3 py-2 text-right">{money(p.icms)}</td>
                          <td className="px-3 py-2">
                            <div className="flex justify-center gap-1">
                              <button
                                onClick={() => setDecision(p.ncm, p.item, true)}
                                className={`px-2 py-1 rounded text-xs ${
                                  decision === true ? "bg-yellow-400 text-neutral-950" : "bg-neutral-800 text-neutral-300"
                                }`}
                              >
                                Alíquota zero
                              </button>
                              <button
                                onClick={() => setDecision(p.ncm, p.item, false)}
                                className={`px-2 py-1 rounded text-xs ${
                                  decision === false ? "bg-neutral-200 text-neutral-950" : "bg-neutral-800 text-neutral-300"
                                }`}
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
                  <p className="px-3 py-6 text-center text-neutral-500">Nenhuma pendência — tudo já está na base.</p>
                )}
              </div>
            )}

            {tab === "marcados" && <GroupTable groups={result.marcados} highlight />}
            {tab === "normais" && <GroupTable groups={result.normais} />}

            <div className="flex flex-wrap gap-3 mt-6">
              <button
                onClick={handleDownloadResult}
                className="rounded-lg border border-neutral-700 px-4 py-2 text-sm hover:bg-neutral-900 transition"
              >
                Baixar resultado processado (.xlsx)
              </button>
              <button
                onClick={handleDownloadUpdatedBase}
                disabled={decidedCount === 0}
                className="rounded-lg bg-amber-400 text-neutral-950 px-4 py-2 text-sm font-medium disabled:opacity-40 disabled:cursor-not-allowed hover:bg-amber-300 transition"
              >
                Baixar base atualizada com {decidedCount} nova(s) regra(s)
              </button>
            </div>
          </section>
        )}
      </div>
    </div>
  );
}

function FileDrop({
  label,
  hint,
  file,
  onSelect,
}: {
  label: string;
  hint: string;
  file: File | null;
  onSelect: (f: File) => void;
}) {
  return (
    <label className="block rounded-xl border border-dashed border-neutral-700 hover:border-amber-400/60 transition p-5 cursor-pointer">
      <span className="block font-medium mb-1">{label}</span>
      <span className="block text-xs text-neutral-500 mb-3">{hint}</span>
      <input
        type="file"
        accept=".xlsx,.xls"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) onSelect(f);
        }}
      />
      <span className="inline-block text-xs rounded-full bg-neutral-800 px-3 py-1">
        {file ? file.name : "Selecionar arquivo..."}
      </span>
    </label>
  );
}

function SummaryCard({
  label,
  count,
  contabil,
  icms,
  color,
}: {
  label: string;
  count: number;
  contabil: number;
  icms: number;
  color: string;
}) {
  return (
    <div className={`rounded-lg px-4 py-3 min-w-[220px] flex-1 ${color}`}>
      <p className="text-xs uppercase tracking-wide opacity-80">{label}</p>
      <p className="text-lg font-semibold">{count} NCM</p>
      <p className="text-xs opacity-80">Contábil: R$ {money(contabil)}</p>
      <p className="text-xs opacity-80">ICMS: R$ {money(icms)}</p>
    </div>
  );
}

function TabButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={`px-4 py-2 text-sm -mb-px border-b-2 transition ${
        active ? "border-amber-400 text-neutral-100" : "border-transparent text-neutral-500 hover:text-neutral-300"
      }`}
    >
      {children}
    </button>
  );
}

function GroupTable({ groups, highlight }: { groups: ProcessResult["marcados"]; highlight?: boolean }) {
  return (
    <div className="overflow-x-auto rounded-lg border border-neutral-800">
      <table className="w-full text-sm">
        <thead className="bg-neutral-900 text-neutral-400">
          <tr>
            <th className="text-left px-3 py-2">NCM / Item</th>
            <th className="text-right px-3 py-2">Valor Contábil</th>
            <th className="text-right px-3 py-2">Valor ICMS</th>
          </tr>
        </thead>
        <tbody>
          {groups.map((g) => (
            <Fragment key={g.ncm}>
              <tr className={`border-t border-neutral-800 font-medium ${highlight ? "bg-yellow-400/90 text-neutral-950" : "bg-neutral-900"}`}>
                <td className="px-3 py-2">{g.ncm}</td>
                <td className="px-3 py-2 text-right">{money(g.contabil)}</td>
                <td className="px-3 py-2 text-right">{money(g.icms)}</td>
              </tr>
              {g.items.map((it) => (
                <tr key={g.ncm + it.item} className="border-t border-neutral-900">
                  <td className="px-3 py-2 pl-8 text-neutral-300">{it.item}</td>
                  <td className="px-3 py-2 text-right text-neutral-400">{money(it.contabil)}</td>
                  <td className="px-3 py-2 text-right text-neutral-400">{money(it.icms)}</td>
                </tr>
              ))}
            </Fragment>
          ))}
          {groups.length === 0 && (
            <tr>
              <td colSpan={3} className="px-3 py-6 text-center text-neutral-500">
                Nada aqui.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
