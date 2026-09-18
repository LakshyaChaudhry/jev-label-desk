export type LabelMode = "noul" | "choice" | "score";

export type ChoiceOption = {
  id: string;
  description: string;
};

export type Criteria = {
  questionId: string;
  instructions: string;
  mode: LabelMode;
  /** Optional yes/no clarifications for noul. */
  noulTrue?: string;
  noulFalse?: string;
  /** Fixed enum options for choice. */
  options: ChoiceOption[];
  /** Inclusive integer scale for score (mapped onto Jev's ordered criteria). */
  scoreMin: number;
  scoreMax: number;
  /** Optional labels for each integer on the score scale (low → high). */
  scoreLabels: string[];
};

export type DatasetRow = Record<string, string>;

export type Dataset = {
  filename: string;
  format: "csv" | "jsonl";
  columns: string[];
  rows: DatasetRow[];
};

export type RowLabel = {
  index: number;
  status: "ok" | "failed";
  label: string;
  confidence: string;
  detail: string;
  model: string;
  error?: string;
};

export type LabelEvent =
  | { type: "start"; total: number; mock: boolean; model: string }
  | { type: "row"; result: RowLabel }
  | { type: "done"; ok: number; failed: number };

export type HealthResponse = {
  mock: boolean;
  hasKey: boolean;
  model: string;
  fallbackModel: string;
};

export type LabelRequest = {
  rows: DatasetRow[];
  textFields: string[];
  criteria: Criteria;
};
