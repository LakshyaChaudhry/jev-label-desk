import type { Dataset, DatasetRow, LabelMode, RowLabel } from "./types";
import { rowsToCsv } from "./parse";

export type ClassMetrics = {
  label: string;
  support: number;
  precision: number;
  recall: number;
  f1: number;
};

export type Disagreement = {
  index: number;
  id: string;
  snippet: string;
  jev: string;
  gold: string;
};

export type ComparisonReport = {
  mode: LabelMode;
  compared: number;
  skipped: number;
  exactMatches: number;
  exactMatchRate: number;
  perClass: ClassMetrics[];
  macroF1: number | null;
  mae: number | null;
  pearson: number | null;
  disagreements: Disagreement[];
};

const GOLD_COLUMN_HINTS = [
  "gold",
  "gold_label",
  "gold_labels",
  "label",
  "opus",
  "opus_label",
  "human",
  "human_label",
];

export function guessGoldColumn(columns: string[]): string | null {
  const lower = columns.map((col) => col.toLowerCase());
  for (const hint of GOLD_COLUMN_HINTS) {
    const i = lower.indexOf(hint);
    if (i >= 0) return columns[i];
  }
  const fuzzy = columns.find((col) => /gold|opus|human/.test(col.toLowerCase()));
  return fuzzy ?? null;
}

export function normalizeLabel(value: string, mode: LabelMode): string {
  const raw = value.trim().toLowerCase();
  if (!raw) return "";
  if (mode === "noul") {
    if (["true", "yes", "y", "1"].includes(raw)) return "true";
    if (["false", "no", "n", "0"].includes(raw)) return "false";
    return raw;
  }
  if (mode === "score") {
    const n = Number(raw);
    if (Number.isFinite(n)) return String(n);
    return raw;
  }
  return raw.replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");
}

export function alignGoldLabels(
  rows: DatasetRow[],
  goldRows: DatasetRow[],
  goldColumn: string,
  idColumn = "id",
): (string | null)[] {
  const datasetHasId = rows.some((row) => row[idColumn]);
  const goldHasId = goldRows.some((row) => row[idColumn]);
  if (datasetHasId && goldHasId) {
    const byId = new Map<string, string>();
    for (const row of goldRows) {
      const id = (row[idColumn] ?? "").trim();
      if (id) byId.set(id, row[goldColumn] ?? "");
    }
    return rows.map((row) => {
      const id = (row[idColumn] ?? "").trim();
      if (!id || !byId.has(id)) return null;
      const value = byId.get(id) ?? "";
      return value.trim() ? value : null;
    });
  }
  return rows.map((_, i) => {
    const value = goldRows[i]?.[goldColumn] ?? "";
    return value.trim() ? value : null;
  });
}

export function goldFromColumn(rows: DatasetRow[], column: string): (string | null)[] {
  return rows.map((row) => {
    const value = (row[column] ?? "").trim();
    return value ? value : null;
  });
}

function rowId(row: DatasetRow, index: number): string {
  return (row.id || row.ID || row.Id || "").trim() || String(index + 1);
}

function snippet(row: DatasetRow, textFields: string[]): string {
  const parts = textFields
    .map((field) => row[field]?.trim())
    .filter((part): part is string => Boolean(part));
  const text = parts.join(" — ") || Object.values(row).find((v) => v.trim()) || "";
  return text.length > 160 ? `${text.slice(0, 157)}…` : text;
}

function pearson(xs: number[], ys: number[]): number | null {
  if (xs.length < 2) return null;
  const n = xs.length;
  const meanX = xs.reduce((a, b) => a + b, 0) / n;
  const meanY = ys.reduce((a, b) => a + b, 0) / n;
  let num = 0;
  let denX = 0;
  let denY = 0;
  for (let i = 0; i < n; i++) {
    const dx = xs[i] - meanX;
    const dy = ys[i] - meanY;
    num += dx * dy;
    denX += dx * dx;
    denY += dy * dy;
  }
  if (denX === 0 || denY === 0) return null;
  return num / Math.sqrt(denX * denY);
}

function classMetrics(pairs: { pred: string; gold: string }[]): ClassMetrics[] {
  const labels = [...new Set(pairs.flatMap((p) => [p.pred, p.gold]))].sort();
  return labels.map((label) => {
    let tp = 0;
    let fp = 0;
    let fn = 0;
    let support = 0;
    for (const pair of pairs) {
      if (pair.gold === label) support += 1;
      if (pair.pred === label && pair.gold === label) tp += 1;
      if (pair.pred === label && pair.gold !== label) fp += 1;
      if (pair.pred !== label && pair.gold === label) fn += 1;
    }
    const precision = tp + fp === 0 ? 0 : tp / (tp + fp);
    const recall = tp + fn === 0 ? 0 : tp / (tp + fn);
    const f1 = precision + recall === 0 ? 0 : (2 * precision * recall) / (precision + recall);
    return { label, support, precision, recall, f1 };
  });
}

export function compareToGold(args: {
  dataset: Dataset;
  results: RowLabel[];
  gold: (string | null)[];
  textFields: string[];
  mode: LabelMode;
}): ComparisonReport {
  const pairs: { index: number; pred: string; gold: string; predRaw: string; goldRaw: string }[] =
    [];
  let skipped = 0;

  args.dataset.rows.forEach((row, index) => {
    const hit = args.results.find((r) => r.index === index);
    const goldRaw = args.gold[index];
    if (!hit || hit.status !== "ok" || !hit.label || !goldRaw) {
      skipped += 1;
      return;
    }
    pairs.push({
      index,
      pred: normalizeLabel(hit.label, args.mode),
      gold: normalizeLabel(goldRaw, args.mode),
      predRaw: hit.label,
      goldRaw,
    });
  });

  const exactMatches = pairs.filter((p) => p.pred === p.gold).length;
  const disagreements: Disagreement[] = pairs
    .filter((p) => p.pred !== p.gold)
    .map((p) => ({
      index: p.index,
      id: rowId(args.dataset.rows[p.index], p.index),
      snippet: snippet(args.dataset.rows[p.index], args.textFields),
      jev: p.predRaw,
      gold: p.goldRaw,
    }));

  const perClass = args.mode === "score" ? [] : classMetrics(pairs);
  const macroF1 =
    perClass.length === 0 ? null : perClass.reduce((sum, c) => sum + c.f1, 0) / perClass.length;

  let mae: number | null = null;
  let corr: number | null = null;
  if (args.mode === "score") {
    const xs: number[] = [];
    const ys: number[] = [];
    for (const pair of pairs) {
      const pred = Number(pair.pred);
      const gold = Number(pair.gold);
      if (Number.isFinite(pred) && Number.isFinite(gold)) {
        xs.push(pred);
        ys.push(gold);
      }
    }
    if (xs.length) {
      mae = xs.reduce((sum, x, i) => sum + Math.abs(x - ys[i]), 0) / xs.length;
      corr = pearson(xs, ys);
    }
  }

  return {
    mode: args.mode,
    compared: pairs.length,
    skipped,
    exactMatches,
    exactMatchRate: pairs.length ? exactMatches / pairs.length : 0,
    perClass,
    macroF1,
    mae,
    pearson: corr,
    disagreements,
  };
}

function pct(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

function dec(value: number | null, digits = 3): string {
  if (value === null || Number.isNaN(value)) return "—";
  return value.toFixed(digits);
}

export function comparisonMarkdown(
  report: ComparisonReport,
  meta: { dataset: string; goldSource: string; model?: string },
): string {
  const lines = [
    "# Jev vs gold",
    "",
    `- Dataset: ${meta.dataset}`,
    `- Gold: ${meta.goldSource}`,
    `- Mode: ${report.mode}`,
    meta.model ? `- Jev model: ${meta.model}` : "",
    `- Compared: ${report.compared} rows (${report.skipped} skipped)`,
    `- Exact match: ${report.exactMatches}/${report.compared} (${pct(report.exactMatchRate)})`,
    "",
  ].filter((line) => line !== "");

  if (report.mode !== "score" && report.perClass.length) {
    lines.push("## Per-class", "");
    lines.push("| class | support | precision | recall | f1 |");
    lines.push("| --- | ---: | ---: | ---: | ---: |");
    for (const row of report.perClass) {
      lines.push(
        `| ${row.label} | ${row.support} | ${dec(row.precision)} | ${dec(row.recall)} | ${dec(row.f1)} |`,
      );
    }
    lines.push("", `Macro-F1: ${dec(report.macroF1)}`, "");
  }

  if (report.mode === "score") {
    lines.push("## Score agreement", "");
    lines.push(`- MAE: ${dec(report.mae)}`);
    lines.push(`- Pearson r: ${dec(report.pearson)}`, "");
  }

  lines.push("## Disagreements", "");
  if (!report.disagreements.length) {
    lines.push("None.");
  } else {
    lines.push("| id | snippet | jev | gold |");
    lines.push("| --- | --- | --- | --- |");
    for (const row of report.disagreements) {
      const clip = row.snippet.replace(/\|/g, "/").replace(/\n/g, " ");
      lines.push(`| ${row.id} | ${clip} | ${row.jev} | ${row.gold} |`);
    }
  }
  lines.push("");
  return lines.join("\n");
}

export function comparisonCsv(report: ComparisonReport): string {
  const rows = report.disagreements.map((row) => ({
    id: row.id,
    snippet: row.snippet,
    jev: row.jev,
    gold: row.gold,
  }));
  return rowsToCsv(rows, ["id", "snippet", "jev", "gold"]);
}
