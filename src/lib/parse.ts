import type { Dataset, DatasetRow } from "./types";

function stripBom(text: string): string {
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

function looksLikeJsonl(text: string): boolean {
  const first = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find((line) => line.length > 0);
  return Boolean(first?.startsWith("{") || first?.startsWith("["));
}

/** RFC-ish CSV parse that keeps quoted commas and escaped quotes. */
export function parseCsv(text: string): DatasetRow[] {
  const src = stripBom(text).replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  const rows: string[][] = [];
  let field = "";
  let row: string[] = [];
  let inQuotes = false;

  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (inQuotes) {
      if (ch === '"') {
        if (src[i + 1] === '"') {
          field += '"';
          i += 1;
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
      continue;
    }
    if (ch === '"') {
      inQuotes = true;
      continue;
    }
    if (ch === ",") {
      row.push(field);
      field = "";
      continue;
    }
    if (ch === "\n") {
      row.push(field);
      field = "";
      if (row.some((cell) => cell.trim() !== "")) rows.push(row);
      row = [];
      continue;
    }
    field += ch;
  }
  row.push(field);
  if (row.some((cell) => cell.trim() !== "")) rows.push(row);

  if (rows.length === 0) return [];
  const headers = rows[0].map((h, i) => h.trim() || `column_${i + 1}`);
  return rows.slice(1).map((cells) => {
    const record: DatasetRow = {};
    headers.forEach((header, i) => {
      record[header] = cells[i] ?? "";
    });
    return record;
  });
}

export function parseJsonl(text: string): DatasetRow[] {
  const lines = stripBom(text).split(/\r?\n/);
  const rows: DatasetRow[] = [];
  for (const [lineNo, raw] of lines.entries()) {
    const line = raw.trim();
    if (!line) continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch {
      throw new Error(`Invalid JSON on line ${lineNo + 1}`);
    }
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error(`JSONL line ${lineNo + 1} must be an object`);
    }
    const record: DatasetRow = {};
    for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
      record[key] = formatCell(value);
    }
    rows.push(record);
  }
  return rows;
}

function formatCell(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return JSON.stringify(value);
}

export function columnsFromRows(rows: DatasetRow[]): string[] {
  const seen = new Set<string>();
  for (const row of rows) {
    for (const key of Object.keys(row)) seen.add(key);
  }
  return [...seen];
}

export function guessTextFields(columns: string[]): string[] {
  const preferred = ["message", "text", "content", "body", "comment", "review", "item"];
  const hits = columns.filter((col) => preferred.includes(col.toLowerCase()));
  if (hits.length > 0) return hits;
  const subject = columns.find((col) => /subject|title|prompt/i.test(col));
  return subject ? [subject] : columns.slice(0, 1);
}

export function parseDataset(filename: string, text: string): Dataset {
  const lower = filename.toLowerCase();
  const format: Dataset["format"] =
    lower.endsWith(".jsonl") || lower.endsWith(".json") || looksLikeJsonl(text)
      ? "jsonl"
      : "csv";
  const rows = format === "jsonl" ? parseJsonl(text) : parseCsv(text);
  if (rows.length === 0) throw new Error("No rows found in file");
  return { filename, format, columns: columnsFromRows(rows), rows };
}

export function buildState(row: DatasetRow, textFields: string[]): unknown {
  const fields = textFields.filter((field) => field in row || row[field] !== undefined);
  if (fields.length === 0) {
    throw new Error("Pick at least one text / context field");
  }
  if (fields.length === 1) return row[fields[0]] ?? "";
  const state: Record<string, string> = {};
  for (const field of fields) state[field] = row[field] ?? "";
  return state;
}

export function toCsvValue(value: string): string {
  if (/[",\n\r]/.test(value)) return `"${value.replace(/"/g, '""')}"`;
  return value;
}

export function rowsToCsv(rows: DatasetRow[], columns: string[]): string {
  const header = columns.map(toCsvValue).join(",");
  const body = rows.map((row) => columns.map((col) => toCsvValue(row[col] ?? "")).join(","));
  return [header, ...body].join("\n") + "\n";
}
