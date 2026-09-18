import type { ChoiceOption, Criteria, LabelMode } from "./types";

export const QUESTION_ID = "label";

export function defaultCriteria(mode: LabelMode = "choice"): Criteria {
  return {
    questionId: QUESTION_ID,
    instructions:
      mode === "noul"
        ? "Does this support ticket request urgent action (outage, lockout, refund, or a hard deadline)?"
        : mode === "choice"
          ? "Which team should handle this support ticket?"
          : "How urgent is this support ticket?",
    mode,
    noulTrue: "Explicit deadline, lockout, outage, money at risk, or a demand for action today",
    noulFalse: "Informational, complimentary, or no time pressure",
    options: [
      { id: "billing", description: "Charges, invoices, refunds, seat counts, credits" },
      { id: "technical", description: "Bugs, outages, login, integrations, product breakage" },
      { id: "sales", description: "Pricing, plans, upgrades, new accounts, evaluations" },
      { id: "other", description: "Compliments, security docs, or anything that does not fit" },
    ],
    scoreMin: 1,
    scoreMax: 5,
    scoreLabels: [
      "1 — no urgency",
      "2 — can wait days",
      "3 — this week",
      "4 — today",
      "5 — blocking / immediate",
    ],
  };
}

export function slugifyOption(value: string, used: Set<string>): string {
  const base =
    value
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_|_$/g, "")
      .slice(0, 32) || "option";
  let id = base;
  let n = 2;
  while (used.has(id)) {
    id = `${base}_${n}`;
    n += 1;
  }
  used.add(id);
  return id;
}

export function normalizeOptions(options: ChoiceOption[]): ChoiceOption[] {
  const used = new Set<string>();
  return options
    .map((opt) => ({
      id: opt.id.trim(),
      description: opt.description.trim(),
    }))
    .filter((opt) => opt.id || opt.description)
    .map((opt) => ({
      id: opt.id ? slugifyOption(opt.id, used) : slugifyOption(opt.description, used),
      description: opt.description || opt.id,
    }));
}

export function scoreCriteriaList(criteria: Criteria): string[] {
  const min = Math.trunc(criteria.scoreMin);
  const max = Math.trunc(criteria.scoreMax);
  if (!Number.isFinite(min) || !Number.isFinite(max) || max <= min) {
    throw new Error("Score scale needs a max greater than min");
  }
  const count = max - min + 1;
  if (count < 2 || count > 10) {
    throw new Error("Jev score scales must have between 2 and 10 levels");
  }
  return Array.from({ length: count }, (_, i) => {
    const value = min + i;
    const label = criteria.scoreLabels[i]?.trim();
    return label || String(value);
  });
}

export function validateCriteria(criteria: Criteria): string | null {
  if (!criteria.instructions.trim()) return "Write the rubric / question.";
  if (criteria.mode === "choice") {
    const options = normalizeOptions(criteria.options);
    if (options.length < 2) return "Choice mode needs at least two options.";
  }
  if (criteria.mode === "score") {
    try {
      scoreCriteriaList(criteria);
    } catch (error) {
      return error instanceof Error ? error.message : "Invalid score range";
    }
  }
  return null;
}

/** TypeSafe / OpenRouter Decisions question object (one named question). */
export function toDecisionsQuestion(criteria: Criteria): Record<string, unknown> {
  const instructions = criteria.instructions.trim();
  if (criteria.mode === "noul") {
    const trueLabel = criteria.noulTrue?.trim();
    const falseLabel = criteria.noulFalse?.trim();
    const question: Record<string, unknown> = { type: "noul", instructions };
    if (trueLabel || falseLabel) {
      question.criteria = {
        ...(trueLabel ? { true: trueLabel } : {}),
        ...(falseLabel ? { false: falseLabel } : {}),
      };
    }
    return { [criteria.questionId || QUESTION_ID]: question };
  }
  if (criteria.mode === "choice") {
    const options = normalizeOptions(criteria.options);
    const optionCriteria: Record<string, string> = {};
    for (const opt of options) optionCriteria[opt.id] = opt.description;
    return {
      [criteria.questionId || QUESTION_ID]: {
        type: "choice",
        instructions,
        criteria: optionCriteria,
      },
    };
  }
  return {
    [criteria.questionId || QUESTION_ID]: {
      type: "score",
      instructions,
      criteria: scoreCriteriaList(criteria),
    },
  };
}
