import * as XLSX from "xlsx";
import ExcelJS from "exceljs";

export type Rule = { ncm: string; item: string; amarelo: boolean };
export type RulesMap = Map<string, Rule>;

export type RawRow = { ncm: string; item: string; contabil: number; icms: number };

export type GroupItem = { item: string; contabil: number; icms: number };
export type Group = { ncm: string; contabil: number; icms: number; items: GroupItem[] };
export type PendingRow = { ncm: string; item: string; contabil: number; icms: number };

export type ProcessResult = {
  marcados: Group[];
  normais: Group[];
  pendentes: PendingRow[];
};

function norm(s: unknown): string {
  return String(s ?? "").trim().toUpperCase();
}

function key(ncm: unknown, item: unknown): string {
  return `${norm(ncm)}|${norm(item)}`;
}

function findHeaderRow(rows: unknown[][], mustHave: string[]): number {
  for (let i = 0; i < Math.min(rows.length, 10); i++) {
    const row = rows[i].map((c) => norm(c));
    if (mustHave.every((h) => row.includes(h))) return i;
  }
  return -1;
}

function colIndex(headerRow: unknown[], candidates: string[]): number {
  const normalized = headerRow.map((c) => norm(c));
  for (const cand of candidates) {
    const idx = normalized.findIndex((h) => h === norm(cand));
    if (idx !== -1) return idx;
  }
  for (const cand of candidates) {
    const idx = normalized.findIndex((h) => h.includes(norm(cand)));
    if (idx !== -1) return idx;
  }
  return -1;
}

async function readSheetAsRows(file: File): Promise<unknown[][]> {
  const buf = await file.arrayBuffer();
  const wb = XLSX.read(buf, { type: "array" });
  const ws = wb.Sheets[wb.SheetNames[0]];
  return XLSX.utils.sheet_to_json(ws, { header: 1, defval: null }) as unknown[][];
}

export async function parseRulesBase(file: File): Promise<RulesMap> {
  const rows = await readSheetAsRows(file);
  const headerIdx = findHeaderRow(rows, ["NCM", "ITEM"]);
  if (headerIdx === -1) throw new Error("Não encontrei as colunas NCM e Item na base de regras.");
  const header = rows[headerIdx];
  const ncmCol = colIndex(header, ["NCM"]);
  const itemCol = colIndex(header, ["Item"]);
  const amareloCol = colIndex(header, ["Aliquota Zero (Amarelo)", "Alíquota Zero (Amarelo)", "Amarelo", "Aliquota Zero"]);

  const rules: RulesMap = new Map();
  for (let i = headerIdx + 1; i < rows.length; i++) {
    const row = rows[i];
    if (!row) continue;
    const ncm = row[ncmCol];
    const item = row[itemCol];
    if (!ncm || !item) continue;
    const amareloRaw = amareloCol !== -1 ? norm(row[amareloCol]) : "";
    const amarelo = amareloRaw === "SIM" || amareloRaw === "TRUE" || amareloRaw === "1";
    rules.set(key(ncm, item), { ncm: String(ncm), item: String(item), amarelo });
  }
  return rules;
}

export async function parseRawFile(file: File): Promise<RawRow[]> {
  const rows = await readSheetAsRows(file);
  const headerIdx = findHeaderRow(rows, ["NCM", "ITEM"]);
  if (headerIdx === -1) throw new Error("Não encontrei as colunas NCM e Item na planilha enviada.");
  const header = rows[headerIdx];
  const ncmCol = colIndex(header, ["NCM"]);
  const itemCol = colIndex(header, ["Item"]);
  const contabilCol = colIndex(header, ["Valor Contábil", "Valor Contabil", "Soma de Valor Contábil", "Soma Valor Contábil"]);
  const icmsCol = colIndex(header, ["Valor ICMS", "Soma de Valor ICMS", "Soma Valor ICMS"]);

  if (ncmCol === -1 || itemCol === -1 || contabilCol === -1 || icmsCol === -1) {
    throw new Error("A planilha precisa ter as colunas: NCM, Item, Valor Contábil e Valor ICMS.");
  }

  const out: RawRow[] = [];
  for (let i = headerIdx + 1; i < rows.length; i++) {
    const row = rows[i];
    if (!row) continue;
    const ncm = row[ncmCol];
    const item = row[itemCol];
    if (!ncm || !item) continue;
    out.push({
      ncm: String(ncm),
      item: String(item),
      contabil: Number(row[contabilCol]) || 0,
      icms: Number(row[icmsCol]) || 0,
    });
  }
  return out;
}

export function processRows(rawRows: RawRow[], rules: RulesMap): ProcessResult {
  const marcadosMap = new Map<string, Group>();
  const normaisMap = new Map<string, Group>();
  const pendentesMap = new Map<string, PendingRow>();

  for (const row of rawRows) {
    const k = key(row.ncm, row.item);
    const rule = rules.get(k);
    if (!rule) {
      const pk = k;
      const existing = pendentesMap.get(pk);
      if (existing) {
        existing.contabil += row.contabil;
        existing.icms += row.icms;
      } else {
        pendentesMap.set(pk, { ncm: row.ncm, item: row.item, contabil: row.contabil, icms: row.icms });
      }
      continue;
    }
    const targetMap = rule.amarelo ? marcadosMap : normaisMap;
    const gk = norm(row.ncm);
    let group = targetMap.get(gk);
    if (!group) {
      group = { ncm: row.ncm, contabil: 0, icms: 0, items: [] };
      targetMap.set(gk, group);
    }
    group.contabil += row.contabil;
    group.icms += row.icms;
    let item = group.items.find((it) => norm(it.item) === norm(row.item));
    if (!item) {
      item = { item: row.item, contabil: 0, icms: 0 };
      group.items.push(item);
    }
    item.contabil += row.contabil;
    item.icms += row.icms;
  }

  const sortByNcm = (a: Group, b: Group) => a.ncm.localeCompare(b.ncm);
  return {
    marcados: [...marcadosMap.values()].sort(sortByNcm),
    normais: [...normaisMap.values()].sort(sortByNcm),
    pendentes: [...pendentesMap.values()].sort((a, b) => a.ncm.localeCompare(b.ncm) || a.item.localeCompare(b.item)),
  };
}

function mergeGroups(groups: Group[], extra: PendingRow[]): Group[] {
  const map = new Map<string, Group>();
  for (const g of groups) map.set(norm(g.ncm), { ncm: g.ncm, contabil: g.contabil, icms: g.icms, items: g.items.map((it) => ({ ...it })) });
  for (const p of extra) {
    const gk = norm(p.ncm);
    let group = map.get(gk);
    if (!group) {
      group = { ncm: p.ncm, contabil: 0, icms: 0, items: [] };
      map.set(gk, group);
    }
    group.contabil += p.contabil;
    group.icms += p.icms;
    let item = group.items.find((it) => norm(it.item) === norm(p.item));
    if (!item) {
      item = { item: p.item, contabil: 0, icms: 0 };
      group.items.push(item);
    }
    item.contabil += p.contabil;
    item.icms += p.icms;
  }
  return [...map.values()].sort((a, b) => a.ncm.localeCompare(b.ncm));
}

export function applyDecisions(result: ProcessResult, decisions: Map<string, boolean>): ProcessResult {
  if (decisions.size === 0) return result;
  const stillPending: PendingRow[] = [];
  const newMarcados: PendingRow[] = [];
  const newNormais: PendingRow[] = [];
  for (const p of result.pendentes) {
    const decision = decisions.get(key(p.ncm, p.item));
    if (decision === undefined) stillPending.push(p);
    else if (decision) newMarcados.push(p);
    else newNormais.push(p);
  }
  return {
    marcados: mergeGroups(result.marcados, newMarcados),
    normais: mergeGroups(result.normais, newNormais),
    pendentes: stillPending.sort((a, b) => a.ncm.localeCompare(b.ncm) || a.item.localeCompare(b.item)),
  };
}

const HEADER_FILL: ExcelJS.Fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF1A1A1A" } };
const YELLOW_FILL: ExcelJS.Fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFFFFF00" } };

function styleHeader(ws: ExcelJS.Worksheet) {
  const row = ws.getRow(1);
  row.font = { bold: true, color: { argb: "FFFFFFFF" } };
  row.fill = HEADER_FILL;
}

function addGroupSheet(wb: ExcelJS.Workbook, title: string, groups: Group[], highlight: boolean) {
  const ws = wb.addWorksheet(title);
  ws.columns = [
    { header: "NCM", key: "ncm", width: 16 },
    { header: "Item", key: "item", width: 55 },
    { header: "Soma Valor Contábil", key: "contabil", width: 20 },
    { header: "Soma Valor ICMS", key: "icms", width: 18 },
  ];
  styleHeader(ws);
  for (const g of groups) {
    const totalRow = ws.addRow({ ncm: g.ncm, item: "", contabil: g.contabil, icms: g.icms });
    totalRow.font = { bold: true };
    if (highlight) totalRow.eachCell((c) => (c.fill = YELLOW_FILL));
    for (const it of g.items) {
      ws.addRow({ ncm: "", item: it.item, contabil: it.contabil, icms: it.icms });
    }
  }
  ws.getColumn("contabil").numFmt = "#,##0.00";
  ws.getColumn("icms").numFmt = "#,##0.00";
}

function addCombinedSheet(wb: ExcelJS.Workbook, marcados: Group[], normais: Group[]) {
  const ws = wb.addWorksheet("Apuração Completa");
  ws.columns = [
    { header: "NCM", key: "ncm", width: 16 },
    { header: "Item", key: "item", width: 55 },
    { header: "Soma Valor Contábil", key: "contabil", width: 20 },
    { header: "Soma Valor ICMS", key: "icms", width: 18 },
  ];
  styleHeader(ws);

  const combined = [
    ...marcados.map((g) => ({ group: g, highlight: true })),
    ...normais.map((g) => ({ group: g, highlight: false })),
  ].sort((a, b) => a.group.ncm.localeCompare(b.group.ncm));

  for (const { group: g, highlight } of combined) {
    const totalRow = ws.addRow({ ncm: g.ncm, item: "", contabil: g.contabil, icms: g.icms });
    totalRow.font = { bold: true };
    if (highlight) totalRow.eachCell((c) => (c.fill = YELLOW_FILL));
    for (const it of g.items) {
      ws.addRow({ ncm: "", item: it.item, contabil: it.contabil, icms: it.icms });
    }
  }
  ws.getColumn("contabil").numFmt = "#,##0.00";
  ws.getColumn("icms").numFmt = "#,##0.00";
}

export async function buildResultWorkbook(result: ProcessResult): Promise<Blob> {
  const wb = new ExcelJS.Workbook();
  addCombinedSheet(wb, result.marcados, result.normais);
  addGroupSheet(wb, "Marcados", result.marcados, true);
  addGroupSheet(wb, "Conhecidos-Normais", result.normais, false);

  const wsP = wb.addWorksheet("Pendentes Reais");
  wsP.columns = [
    { header: "NCM", key: "ncm", width: 16 },
    { header: "Item", key: "item", width: 55 },
    { header: "Soma Valor Contábil", key: "contabil", width: 20 },
    { header: "Soma Valor ICMS", key: "icms", width: 18 },
  ];
  styleHeader(wsP);
  for (const p of result.pendentes) {
    wsP.addRow({ ncm: p.ncm, item: p.item, contabil: p.contabil, icms: p.icms });
  }
  wsP.getColumn("contabil").numFmt = "#,##0.00";
  wsP.getColumn("icms").numFmt = "#,##0.00";

  const buf = await wb.xlsx.writeBuffer();
  return new Blob([buf], { type: "application/octet-stream" });
}

export async function buildUpdatedBase(rules: RulesMap, pendentes: PendingRow[], decisions: Map<string, boolean>): Promise<Blob> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Base de Regras");
  ws.columns = [
    { header: "NCM", key: "ncm", width: 16 },
    { header: "Item", key: "item", width: 55 },
    { header: "Aliquota Zero (Amarelo)", key: "amarelo", width: 22 },
  ];
  styleHeader(ws);

  const merged = new Map(rules);
  for (const p of pendentes) {
    const k = `${norm(p.ncm)}|${norm(p.item)}`;
    const decision = decisions.get(k);
    if (decision === undefined) continue;
    merged.set(k, { ncm: p.ncm, item: p.item, amarelo: decision });
  }

  const sorted = [...merged.values()].sort((a, b) => a.ncm.localeCompare(b.ncm) || a.item.localeCompare(b.item));
  for (const r of sorted) {
    const row = ws.addRow({ ncm: r.ncm, item: r.item, amarelo: r.amarelo ? "SIM" : "NAO" });
    if (r.amarelo) row.eachCell((c) => (c.fill = YELLOW_FILL));
  }

  const buf = await wb.xlsx.writeBuffer();
  return new Blob([buf], { type: "application/octet-stream" });
}

export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
