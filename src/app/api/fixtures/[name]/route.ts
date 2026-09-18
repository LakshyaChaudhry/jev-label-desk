import { readFile } from "node:fs/promises";
import path from "node:path";

const ALLOWED: Record<string, string> = {
  "support-tickets.csv": "text/csv; charset=utf-8",
  "support-tickets.jsonl": "application/x-ndjson; charset=utf-8",
};

export async function GET(
  _request: Request,
  context: { params: Promise<{ name: string }> },
) {
  const { name } = await context.params;
  const type = ALLOWED[name];
  if (!type) return new Response("Not found", { status: 404 });
  const file = await readFile(path.join(process.cwd(), "fixtures", name), "utf8");
  return new Response(file, { headers: { "Content-Type": type } });
}
