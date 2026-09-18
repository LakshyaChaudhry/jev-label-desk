import { QUESTION_ID, scoreCriteriaList, toDecisionsQuestion } from "./criteria";
import { mockDecide } from "./mock";
import type { Criteria, RowLabel } from "./types";

const PRIMARY_MODEL = process.env.JEV_MODEL || "~typesafe/jev-latest";
const FALLBACK_MODEL = process.env.JEV_FALLBACK_MODEL || "typesafe/jev-1.13";
const DECISIONS_URL =
  process.env.OPENROUTER_DECISIONS_URL || "https://openrouter.ai/api/alpha/decisions";

export function isMockEnabled(): boolean {
  const flag = (process.env.JEV_MOCK || "").toLowerCase();
  return flag === "1" || flag === "true" || flag === "yes";
}

export function hasApiKey(): boolean {
  return Boolean(process.env.OPENROUTER_API_KEY?.trim());
}

export function modelConfig() {
  return { model: PRIMARY_MODEL, fallbackModel: FALLBACK_MODEL };
}

type DecisionsAnswer =
  | { type: "noul"; noul?: number }
  | {
      type: "choice";
      choice?: string;
      confidence?: number;
      probabilities?: Record<string, number>;
    }
  | {
      type: "score";
      score?: number;
      confidence?: number;
      legend?: Record<string, string>;
      probabilities?: Record<string, number>;
    };

type DecisionsResponse = {
  answers?: Record<string, DecisionsAnswer>;
  model?: string;
  error?: { message?: string } | string;
  message?: string;
};

class TransientError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TransientError";
  }
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isTransientStatus(status: number) {
  return status === 408 || status === 409 || status === 429 || status >= 500;
}

async function postDecisions(
  model: string,
  state: unknown,
  questions: Record<string, unknown>,
): Promise<DecisionsResponse> {
  const key = process.env.OPENROUTER_API_KEY?.trim();
  if (!key) throw new Error("OPENROUTER_API_KEY is not set");

  const response = await fetch(DECISIONS_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
      "HTTP-Referer": "https://github.com/LakshyaChaudhry/jev-label-desk",
      "X-Title": "Jev Label Desk",
    },
    body: JSON.stringify({
      model,
      state,
      questions,
      provider: { allow_fallbacks: true },
    }),
  });

  const text = await response.text();
  let json: DecisionsResponse = {};
  if (text) {
    try {
      json = JSON.parse(text) as DecisionsResponse;
    } catch {
      json = { message: text.slice(0, 400) };
    }
  }

  if (!response.ok) {
    const message =
      (typeof json.error === "object" && json.error?.message) ||
      (typeof json.error === "string" ? json.error : null) ||
      json.message ||
      `OpenRouter ${response.status}`;
    if (isTransientStatus(response.status)) throw new TransientError(message);
    throw new Error(message);
  }
  return json;
}

async function decideWithRetry(
  state: unknown,
  questions: Record<string, unknown>,
): Promise<DecisionsResponse> {
  const models = [PRIMARY_MODEL, FALLBACK_MODEL].filter(
    (model, i, all) => all.indexOf(model) === i,
  );
  let lastError: Error = new Error("No model attempted");

  for (const model of models) {
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        return await postDecisions(model, state, questions);
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));
        const transient = lastError instanceof TransientError || lastError.name === "FetchError";
        if (!transient) break;
        await sleep(400 * 2 ** attempt);
      }
    }
  }
  throw lastError;
}

function formatNum(value: number | undefined): string {
  if (typeof value !== "number" || Number.isNaN(value)) return "";
  return String(Math.round(value * 1000) / 1000);
}

function extractAnswer(
  response: DecisionsResponse,
  criteria: Criteria,
): Omit<RowLabel, "index" | "status" | "error"> {
  const id = criteria.questionId || QUESTION_ID;
  const answer = response.answers?.[id] ?? Object.values(response.answers ?? {})[0];
  const model = response.model || PRIMARY_MODEL;
  if (!answer) {
    throw new Error("Decisions response had no answers");
  }

  if (answer.type === "noul" || criteria.mode === "noul") {
    const noul = "noul" in answer ? answer.noul : undefined;
    if (typeof noul !== "number") throw new Error("Missing noul probability");
    const yes = noul >= 0.5;
    return {
      label: yes ? "true" : "false",
      confidence: formatNum(yes ? noul : 1 - noul),
      detail: `noul=${formatNum(noul)}`,
      model,
    };
  }

  if (answer.type === "choice" || criteria.mode === "choice") {
    const choice = "choice" in answer ? answer.choice : undefined;
    if (!choice) throw new Error("Missing choice");
    const confidence = "confidence" in answer ? answer.confidence : undefined;
    const probabilities = "probabilities" in answer ? answer.probabilities : undefined;
    return {
      label: choice,
      confidence: formatNum(confidence ?? probabilities?.[choice]),
      detail: probabilities ? JSON.stringify(probabilities) : "",
      model,
    };
  }

  const score = "score" in answer ? answer.score : undefined;
  if (typeof score !== "number") throw new Error("Missing score");
  const min = Math.trunc(criteria.scoreMin);
  const mapped = min + score;
  const levels = scoreCriteriaList(criteria);
  const nearest = Math.min(levels.length - 1, Math.max(0, Math.round(score)));
  const confidence = "confidence" in answer ? answer.confidence : undefined;
  return {
    label: formatNum(mapped),
    confidence: formatNum(confidence),
    detail: `${levels[nearest] ?? ""} (raw=${formatNum(score)})`,
    model,
  };
}

export async function labelState(state: unknown, criteria: Criteria): Promise<Omit<RowLabel, "index">> {
  const questions = toDecisionsQuestion(criteria);
  if (isMockEnabled()) {
    const mocked = mockDecide(state, criteria, questions);
    return { ...mocked, status: "ok" };
  }
  const response = await decideWithRetry(state, questions);
  return { ...extractAnswer(response, criteria), status: "ok" };
}

export function concurrency(): number {
  const parsed = Number(process.env.JEV_CONCURRENCY || 4);
  return Number.isFinite(parsed) ? Math.min(8, Math.max(1, Math.trunc(parsed))) : 4;
}
