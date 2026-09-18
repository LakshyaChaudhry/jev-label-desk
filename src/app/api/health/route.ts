import { hasApiKey, isMockEnabled, modelConfig } from "@/lib/decisions";
import type { HealthResponse } from "@/lib/types";

export async function GET() {
  const models = modelConfig();
  const body: HealthResponse = {
    mock: isMockEnabled(),
    hasKey: hasApiKey(),
    model: models.model,
    fallbackModel: models.fallbackModel,
  };
  return Response.json(body);
}
