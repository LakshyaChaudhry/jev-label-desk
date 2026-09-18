import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import {
  alignGoldLabels,
  compareToGold,
  comparisonMarkdown,
  guessGoldColumn,
  normalizeLabel,
} from "./compare";
import { parseDataset } from "./parse";
import type { Dataset, RowLabel } from "./types";

describe("normalizeLabel", () => {
  it("collapses noul synonyms", () => {
    assert.equal(normalizeLabel("Yes", "noul"), "true");
    assert.equal(normalizeLabel("0", "noul"), "false");
  });
});

describe("alignGoldLabels", () => {
  it("joins on id when both sides have it", () => {
    const gold = parseDataset(
      "gold.csv",
      readFileSync("fixtures/support-tickets.gold.csv", "utf8"),
    );
    const data = parseDataset(
      "tickets.csv",
      readFileSync("fixtures/support-tickets.csv", "utf8"),
    );
    const aligned = alignGoldLabels(data.rows, gold.rows, "gold");
    assert.equal(aligned[0], "technical");
    assert.equal(aligned[7], "sales");
  });

  it("guesses the gold column", () => {
    assert.equal(guessGoldColumn(["id", "gold_label", "text"]), "gold_label");
  });
});

describe("compareToGold", () => {
  function sheet(labels: string[]): { dataset: Dataset; results: RowLabel[] } {
    const dataset: Dataset = {
      filename: "demo.csv",
      format: "csv",
      columns: ["id", "text"],
      rows: labels.map((_, i) => ({ id: `R${i + 1}`, text: `item ${i + 1}` })),
    };
    const results: RowLabel[] = labels.map((label, index) => ({
      index,
      status: "ok",
      label,
      confidence: "0.9",
      detail: "",
      model: "mock/jev",
    }));
    return { dataset, results };
  }

  it("computes exact match and per-class F1 for choice", () => {
    const { dataset, results } = sheet(["billing", "technical", "sales"]);
    const report = compareToGold({
      dataset,
      results,
      gold: ["billing", "sales", "sales"],
      textFields: ["text"],
      mode: "choice",
    });
    assert.equal(report.compared, 3);
    assert.equal(report.exactMatches, 2);
    assert.equal(report.disagreements.length, 1);
    assert.equal(report.disagreements[0].id, "R2");
    const sales = report.perClass.find((c) => c.label === "sales");
    assert.ok(sales);
    assert.equal(sales.recall, 0.5);
    assert.match(comparisonMarkdown(report, { dataset: "demo.csv", goldSource: "col" }), /Exact match/);
  });

  it("computes MAE and Pearson for score", () => {
    const { dataset, results } = sheet(["1", "3", "5"]);
    const report = compareToGold({
      dataset,
      results,
      gold: ["2", "3", "4"],
      textFields: ["text"],
      mode: "score",
    });
    assert.equal(report.mae, 2 / 3);
    assert.ok(report.pearson !== null && report.pearson > 0.9);
  });
});
