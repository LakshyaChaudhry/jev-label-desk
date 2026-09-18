"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { defaultCriteria, validateCriteria } from "@/lib/criteria";
import { guessTextFields, parseDataset, rowsToCsv } from "@/lib/parse";
import type {
  Criteria,
  Dataset,
  HealthResponse,
  LabelEvent,
  LabelMode,
  RowLabel,
} from "@/lib/types";

const STEPS = ["Upload", "Fields", "Criteria", "Label"] as const;
type Step = (typeof STEPS)[number];

export function Desk() {
  const [step, setStep] = useState<Step>("Upload");
  const [health, setHealth] = useState<HealthResponse | null>(null);
  const [dataset, setDataset] = useState<Dataset | null>(null);
  const [textFields, setTextFields] = useState<string[]>([]);
  const [criteria, setCriteria] = useState<Criteria>(defaultCriteria("choice"));
  const [error, setError] = useState<string>("");
  const [running, setRunning] = useState(false);
  const [results, setResults] = useState<RowLabel[]>([]);
  const [progress, setProgress] = useState({ done: 0, total: 0, ok: 0, failed: 0 });
  const [dragOver, setDragOver] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    fetch("/api/health")
      .then((res) => res.json())
      .then((data: HealthResponse) => setHealth(data))
      .catch(() => setHealth(null));
  }, []);

  const labeledRows = useMemo(() => {
    if (!dataset) return [];
    return dataset.rows.map((row, index) => {
      const hit = results.find((r) => r.index === index);
      return {
        ...row,
        label: hit?.label ?? "",
        confidence: hit?.confidence ?? "",
        label_detail: hit?.detail ?? "",
        model: hit?.model ?? "",
        error: hit?.error ?? "",
      };
    });
  }, [dataset, results]);

  function applyFile(file: File) {
    setError("");
    setResults([]);
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const parsed = parseDataset(file.name, String(reader.result ?? ""));
        setDataset(parsed);
        setTextFields(guessTextFields(parsed.columns));
        setStep("Fields");
      } catch (err) {
        setError(err instanceof Error ? err.message : "Could not parse file");
      }
    };
    reader.readAsText(file);
  }

  async function loadFixture(name: "csv" | "jsonl") {
    setError("");
    const path =
      name === "csv"
        ? "/api/fixtures/support-tickets.csv"
        : "/api/fixtures/support-tickets.jsonl";
    const res = await fetch(path);
    if (!res.ok) {
      setError("Could not load fixture from /public. Try uploading fixtures/ from the repo.");
      return;
    }
    const text = await res.text();
    const filename = name === "csv" ? "support-tickets.csv" : "support-tickets.jsonl";
    const parsed = parseDataset(filename, text);
    setDataset(parsed);
    setTextFields(guessTextFields(parsed.columns));
    setResults([]);
    setStep("Fields");
  }

  function toggleField(column: string) {
    setTextFields((current) =>
      current.includes(column) ? current.filter((c) => c !== column) : [...current, column],
    );
  }

  function goCriteria() {
    if (!textFields.length) {
      setError("Pick at least one text / context field.");
      return;
    }
    setError("");
    setStep("Criteria");
  }

  async function runBatch() {
    if (!dataset) return;
    const problem = validateCriteria(criteria);
    if (problem) {
      setError(problem);
      return;
    }
    setError("");
    setRunning(true);
    setResults([]);
    setProgress({ done: 0, total: dataset.rows.length, ok: 0, failed: 0 });
    setStep("Label");

    try {
      const response = await fetch("/api/label", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          rows: dataset.rows,
          textFields,
          criteria,
        }),
      });

      if (!response.ok || !response.body) {
        const payload = await response.json().catch(() => ({ error: "Label request failed" }));
        throw new Error(payload.error || `HTTP ${response.status}`);
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      const collected: RowLabel[] = [];

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        for (const line of lines) {
          if (!line.trim()) continue;
          const event = JSON.parse(line) as LabelEvent;
          if (event.type === "start") {
            setProgress((p) => ({ ...p, total: event.total }));
          }
          if (event.type === "row") {
            collected.push(event.result);
            setResults([...collected].sort((a, b) => a.index - b.index));
            setProgress((p) => ({
              ...p,
              done: collected.length,
              ok: collected.filter((r) => r.status === "ok").length,
              failed: collected.filter((r) => r.status === "failed").length,
            }));
          }
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Batch failed");
    } finally {
      setRunning(false);
    }
  }

  function exportCsv() {
    if (!dataset) return;
    const columns = [...dataset.columns, "label", "confidence", "label_detail", "model", "error"];
    const csv = rowsToCsv(labeledRows, columns);
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = dataset.filename.replace(/\.(csv|jsonl|json)$/i, "") + "-labeled.csv";
    a.click();
    URL.revokeObjectURL(url);
  }

  const healthLabel = health
    ? health.mock
      ? "Mock mode — no API calls"
      : health.hasKey
        ? `Live · ${health.model}`
        : "Missing OPENROUTER_API_KEY"
    : "Checking API…";

  return (
    <div className="app">
      <header className="masthead">
        <div>
          <div className="eyebrow">TypeSafe Jev · OpenRouter Decisions</div>
          <h1>Jev Label Desk</h1>
          <p className="lede">
            Upload a CSV or JSONL, name the text, write a rubric, batch-label every row, export the
            sheet.
          </p>
        </div>
        <div className="status-pill">{healthLabel}</div>
      </header>

      <nav className="steps">
        {STEPS.map((name) => (
          <button
            key={name}
            className={`step ${step === name ? "active" : ""}`}
            onClick={() => {
              if (name === "Upload") setStep(name);
              if (name === "Fields" && dataset) setStep(name);
              if (name === "Criteria" && dataset && textFields.length) setStep(name);
              if (name === "Label" && results.length) setStep(name);
            }}
            type="button"
          >
            <b>0{STEPS.indexOf(name) + 1}</b>
            {name}
          </button>
        ))}
      </nav>

      {step === "Upload" && (
        <section className="panel">
          <h2>Upload a dataset</h2>
          <p className="hint">CSV or JSONL. Columns are detected from the header or object keys.</p>
          <div
            className={`drop ${dragOver ? "over" : ""}`}
            onDragOver={(e) => {
              e.preventDefault();
              setDragOver(true);
            }}
            onDragLeave={() => setDragOver(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDragOver(false);
              const file = e.dataTransfer.files[0];
              if (file) applyFile(file);
            }}
          >
            <p>Drop a file here, or choose one from disk.</p>
            <div className="row">
              <button className="btn" type="button" onClick={() => fileRef.current?.click()}>
                Choose file
              </button>
              <button className="btn secondary" type="button" onClick={() => loadFixture("csv")}>
                Load sample CSV
              </button>
              <button className="btn ghost" type="button" onClick={() => loadFixture("jsonl")}>
                Load sample JSONL
              </button>
            </div>
            <input
              ref={fileRef}
              type="file"
              accept=".csv,.jsonl,.json,text/csv,application/json"
              hidden
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) applyFile(file);
              }}
            />
          </div>
          {error && <p className="error">{error}</p>}
        </section>
      )}

      {step === "Fields" && dataset && (
        <section className="panel">
          <h2>Which fields are the item?</h2>
          <p className="hint">
            {dataset.filename} · {dataset.rows.length} rows · {dataset.columns.length} columns.
            Selected fields become Jev&apos;s <code>state</code>.
          </p>
          <div className="chips">
            {dataset.columns.map((column) => (
              <label className="chip" key={column}>
                <input
                  type="checkbox"
                  checked={textFields.includes(column)}
                  onChange={() => toggleField(column)}
                />
                {column}
              </label>
            ))}
          </div>
          <div className="table-wrap" style={{ marginTop: 22 }}>
            <table className="preview">
              <thead>
                <tr>
                  {dataset.columns.map((column) => (
                    <th key={column}>{column}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {dataset.rows.slice(0, 5).map((row, i) => (
                  <tr key={i}>
                    {dataset.columns.map((column) => (
                      <td key={column}>
                        <span className="clip">{row[column]}</span>
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {error && <p className="error">{error}</p>}
          <div className="footer-actions">
            <button className="btn ghost" type="button" onClick={() => setStep("Upload")}>
              Back
            </button>
            <button className="btn" type="button" onClick={goCriteria}>
              Continue to criteria
            </button>
          </div>
        </section>
      )}

      {step === "Criteria" && (
        <section className="panel">
          <h2>Label criteria</h2>
          <p className="hint">
            One Jev question for every row. Modes match the Decisions primitives: noul, choice,
            score.
          </p>
          <div className="modes">
            {(
              [
                ["noul", "Yes / no", "Probability that the statement is true"],
                ["choice", "Fixed options", "Pick one enum you define"],
                ["score", "Numeric scale", "Ordered min–max rubric"],
              ] as const
            ).map(([mode, title, blurb]) => (
              <button
                key={mode}
                type="button"
                className={`mode ${criteria.mode === mode ? "active" : ""}`}
                onClick={() =>
                  setCriteria((c) => ({
                    ...defaultCriteria(mode as LabelMode),
                    instructions: c.instructions,
                    mode: mode as LabelMode,
                  }))
                }
              >
                <b>{title}</b>
                <small>{blurb}</small>
              </button>
            ))}
          </div>
          <div className="grid">
            <label className="field">
              <span>Rubric / question</span>
              <textarea
                value={criteria.instructions}
                onChange={(e) => setCriteria((c) => ({ ...c, instructions: e.target.value }))}
              />
            </label>
            {criteria.mode === "noul" && (
              <div>
                <label className="field">
                  <span>True means</span>
                  <input
                    type="text"
                    value={criteria.noulTrue ?? ""}
                    onChange={(e) => setCriteria((c) => ({ ...c, noulTrue: e.target.value }))}
                  />
                </label>
                <label className="field" style={{ marginTop: 12 }}>
                  <span>False means</span>
                  <input
                    type="text"
                    value={criteria.noulFalse ?? ""}
                    onChange={(e) => setCriteria((c) => ({ ...c, noulFalse: e.target.value }))}
                  />
                </label>
              </div>
            )}
            {criteria.mode === "choice" && (
              <div>
                <div className="field-label">Options</div>
                {criteria.options.map((opt, i) => (
                  <div className="option-row" key={i}>
                    <input
                      type="text"
                      placeholder="id"
                      value={opt.id}
                      onChange={(e) =>
                        setCriteria((c) => ({
                          ...c,
                          options: c.options.map((o, j) =>
                            j === i ? { ...o, id: e.target.value } : o,
                          ),
                        }))
                      }
                    />
                    <input
                      type="text"
                      placeholder="description"
                      value={opt.description}
                      onChange={(e) =>
                        setCriteria((c) => ({
                          ...c,
                          options: c.options.map((o, j) =>
                            j === i ? { ...o, description: e.target.value } : o,
                          ),
                        }))
                      }
                    />
                    <button
                      className="btn ghost"
                      type="button"
                      onClick={() =>
                        setCriteria((c) => ({
                          ...c,
                          options: c.options.filter((_, j) => j !== i),
                        }))
                      }
                    >
                      Remove
                    </button>
                  </div>
                ))}
                <button
                  className="btn secondary"
                  type="button"
                  onClick={() =>
                    setCriteria((c) => ({
                      ...c,
                      options: [...c.options, { id: "", description: "" }],
                    }))
                  }
                >
                  Add option
                </button>
              </div>
            )}
            {criteria.mode === "score" && (
              <div>
                <div className="score-row">
                  <label className="field">
                    <span>Min</span>
                    <input
                      type="number"
                      value={criteria.scoreMin}
                      onChange={(e) =>
                        setCriteria((c) => ({ ...c, scoreMin: Number(e.target.value) }))
                      }
                    />
                  </label>
                  <label className="field">
                    <span>Max</span>
                    <input
                      type="number"
                      value={criteria.scoreMax}
                      onChange={(e) =>
                        setCriteria((c) => ({ ...c, scoreMax: Number(e.target.value) }))
                      }
                    />
                  </label>
                </div>
                <label className="field" style={{ marginTop: 12 }}>
                  <span>Level labels, low to high (optional)</span>
                  <textarea
                    value={criteria.scoreLabels.join("\n")}
                    onChange={(e) =>
                      setCriteria((c) => ({
                        ...c,
                        scoreLabels: e.target.value.split("\n"),
                      }))
                    }
                  />
                </label>
              </div>
            )}
          </div>
          {error && <p className="error">{error}</p>}
          <div className="footer-actions">
            <button className="btn ghost" type="button" onClick={() => setStep("Fields")}>
              Back
            </button>
            <button className="btn" type="button" onClick={runBatch} disabled={running}>
              Batch label {dataset?.rows.length ?? 0} rows
            </button>
          </div>
        </section>
      )}

      {step === "Label" && dataset && (
        <section className="panel">
          <h2>{running ? "Labeling…" : "Labeled sheet"}</h2>
          <p className="hint">
            Failed rows stay in the table. Transient OpenRouter errors are retried; a row never
            aborts the batch.
          </p>
          <div className="bar">
            <i
              style={{
                width: `${progress.total ? (progress.done / progress.total) * 100 : 0}%`,
              }}
            />
          </div>
          <p className="meta">
            {progress.done}/{progress.total} · <span className="ok">{progress.ok} ok</span> ·{" "}
            <span className="bad">{progress.failed} failed</span>
            {running ? " · working" : ""}
          </p>
          <div className="table-wrap">
            <table className="preview">
              <thead>
                <tr>
                  <th>#</th>
                  {textFields.map((field) => (
                    <th key={field}>{field}</th>
                  ))}
                  <th>label</th>
                  <th>confidence</th>
                  <th>status</th>
                </tr>
              </thead>
              <tbody>
                {dataset.rows.map((row, i) => {
                  const hit = results.find((r) => r.index === i);
                  return (
                    <tr key={i}>
                      <td>{i + 1}</td>
                      {textFields.map((field) => (
                        <td key={field}>
                          <span className="clip">{row[field]}</span>
                        </td>
                      ))}
                      <td>{hit?.label || "—"}</td>
                      <td>{hit?.confidence || ""}</td>
                      <td className={hit?.status === "failed" ? "bad" : "ok"}>
                        {hit?.status === "failed" ? hit.error : hit ? "ok" : running ? "…" : ""}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {error && <p className="error">{error}</p>}
          <div className="footer-actions">
            <button className="btn ghost" type="button" onClick={() => setStep("Criteria")}>
              Edit criteria
            </button>
            <div className="row" style={{ marginTop: 0 }}>
              <button className="btn secondary" type="button" onClick={runBatch} disabled={running}>
                Re-run batch
              </button>
              <button
                className="btn"
                type="button"
                onClick={exportCsv}
                disabled={!results.length || running}
              >
                Export labeled CSV
              </button>
            </div>
          </div>
        </section>
      )}
    </div>
  );
}
