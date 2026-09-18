import { scoreCriteriaList } from "./criteria";
import type { Criteria, RowLabel } from "./types";

function hashText(value: string): number {
  let h = 2166136261;
  for (let i = 0; i < value.length; i++) {
    h ^= value.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function stateText(state: unknown): string {
  return typeof state === "string" ? state : JSON.stringify(state);
}

function keywordScore(text: string, needles: string[]): number {
  const lower = text.toLowerCase();
  return needles.reduce((sum, word) => sum + (lower.includes(word) ? 1 : 0), 0);
}

/** Deterministic stand-in so the desk can be demoed without a key. */
export function mockDecide(
  state: unknown,
  criteria: Criteria,
  _questions: Record<string, unknown>,
): Omit<RowLabel, "index" | "status" | "error"> {
  const text = stateText(state);
  const h = hashText(text);

  if (criteria.mode === "noul") {
    const urgent =
      keywordScore(text, [
        "refund",
        "locked",
        "lockout",
        "twice",
        "blocking",
        "today",
        "payroll",
        "fails",
        "stopped",
        "never arrived",
      ]) >= 1;
    const noul = urgent ? 0.86 + (h % 10) / 100 : 0.12 + (h % 8) / 100;
    return {
      label: noul >= 0.5 ? "true" : "false",
      confidence: noul >= 0.5 ? noul.toFixed(3) : (1 - noul).toFixed(3),
      detail: `noul=${noul.toFixed(3)} (mock)`,
      model: "mock/jev",
    };
  }

  if (criteria.mode === "choice") {
    const options = criteria.options.filter((opt) => opt.id.trim());
    const billing = keywordScore(text, ["charge", "invoice", "refund", "seat", "credit", "billed"]);
    const technical = keywordScore(text, [
      "password",
      "login",
      "export",
      "spinner",
      "sync",
      "hubspot",
      "bug",
      "fail",
    ]);
    const sales = keywordScore(text, ["pricing", "plan", "team plan", "discount", "evaluat"]);
    const scores: Record<string, number> = {
      billing,
      technical,
      sales,
      other: billing + technical + sales === 0 ? 1 : 0,
    };
    let picked = options[h % Math.max(options.length, 1)]?.id || "other";
    let best = -1;
    for (const opt of options) {
      const score = scores[opt.id] ?? 0;
      if (score > best) {
        best = score;
        picked = opt.id;
      }
    }
    const probabilities: Record<string, number> = {};
    const remaining = 0.12;
    const share = options.length > 1 ? remaining / (options.length - 1) : 0;
    for (const opt of options) {
      probabilities[opt.id] = opt.id === picked ? 0.88 : Number(share.toFixed(3));
    }
    return {
      label: picked,
      confidence: "0.88",
      detail: JSON.stringify(probabilities),
      model: "mock/jev",
    };
  }

  const levels = scoreCriteriaList(criteria);
  const urgency = keywordScore(text, [
    "today",
    "blocking",
    "locked",
    "payroll",
    "never",
    "fails",
    "stopped",
    "refund",
  ]);
  const idx = Math.min(levels.length - 1, urgency);
  const raw = idx + ((h % 20) / 100) * (idx < levels.length - 1 ? 1 : 0);
  const mapped = criteria.scoreMin + raw;
  return {
    label: String(Math.round(mapped * 100) / 100),
    confidence: "0.9",
    detail: `${levels[idx]} (raw=${raw.toFixed(2)}, mock)`,
    model: "mock/jev",
  };
}
