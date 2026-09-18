import { concurrency, hasApiKey, isMockEnabled, labelState, modelConfig } from "@/lib/decisions";
import { buildState } from "@/lib/parse";
import { validateCriteria } from "@/lib/criteria";
import type { LabelEvent, LabelRequest, RowLabel } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function writeEvent(controller: ReadableStreamDefaultController, event: LabelEvent) {
  controller.enqueue(new TextEncoder().encode(`${JSON.stringify(event)}\n`));
}

export async function POST(request: Request) {
  let body: LabelRequest;
  try {
    body = (await request.json()) as LabelRequest;
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const rows = Array.isArray(body.rows) ? body.rows : [];
  const textFields = Array.isArray(body.textFields) ? body.textFields : [];
  const criteria = body.criteria;

  if (!criteria || !rows.length) {
    return Response.json({ error: "Need rows and criteria" }, { status: 400 });
  }
  if (!textFields.length) {
    return Response.json({ error: "Pick at least one text / context field" }, { status: 400 });
  }
  const invalid = validateCriteria(criteria);
  if (invalid) return Response.json({ error: invalid }, { status: 400 });
  if (!isMockEnabled() && !hasApiKey()) {
    return Response.json(
      { error: "Set OPENROUTER_API_KEY or enable JEV_MOCK=1" },
      { status: 400 },
    );
  }

  const limit = concurrency();
  const models = modelConfig();

  const stream = new ReadableStream({
    async start(controller) {
      writeEvent(controller, {
        type: "start",
        total: rows.length,
        mock: isMockEnabled(),
        model: isMockEnabled() ? "mock/jev" : models.model,
      });

      let next = 0;
      let ok = 0;
      let failed = 0;

      async function worker() {
        while (next < rows.length) {
          const index = next;
          next += 1;
          const row = rows[index];
          let result: RowLabel;
          try {
            const state = buildState(row, textFields);
            const labeled = await labelState(state, criteria);
            result = { index, ...labeled };
            ok += 1;
          } catch (error) {
            failed += 1;
            result = {
              index,
              status: "failed",
              label: "",
              confidence: "",
              detail: "",
              model: "",
              error: error instanceof Error ? error.message : String(error),
            };
          }
          writeEvent(controller, { type: "row", result });
        }
      }

      await Promise.all(Array.from({ length: Math.min(limit, rows.length) }, () => worker()));
      writeEvent(controller, { type: "done", ok, failed });
      controller.close();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}
