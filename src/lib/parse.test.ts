import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { defaultCriteria, toDecisionsQuestion, validateCriteria } from "./criteria";
import { columnsFromRows, parseCsv, parseDataset, parseJsonl, rowsToCsv } from "./parse";

describe("parseCsv", () => {
  it("keeps quoted commas", () => {
    const rows = parseCsv('id,note\n1,"hello, world"\n');
    assert.equal(rows[0].note, "hello, world");
  });
});

describe("fixtures", () => {
  it("parses the CSV happy-path file", () => {
    const text = readFileSync("fixtures/support-tickets.csv", "utf8");
    const dataset = parseDataset("support-tickets.csv", text);
    assert.equal(dataset.format, "csv");
    assert.equal(dataset.rows.length, 8);
    assert.deepEqual(dataset.columns, ["id", "channel", "subject", "message"]);
    assert.match(dataset.rows[1].message, /charged twice/i);
  });

  it("parses the JSONL happy-path file", () => {
    const text = readFileSync("fixtures/support-tickets.jsonl", "utf8");
    const rows = parseJsonl(text);
    assert.equal(rows.length, 8);
    assert.deepEqual(columnsFromRows(rows), ["id", "channel", "subject", "message"]);
  });

  it("round-trips CSV export headers", () => {
    const rows = parseCsv("a,b\n1,2\n");
    const csv = rowsToCsv(rows, ["a", "b", "label"]);
    assert.match(csv, /^a,b,label\n1,2,\n/);
  });
});

describe("criteria", () => {
  it("builds a TypeSafe choice question", () => {
    const q = toDecisionsQuestion(defaultCriteria("choice"));
    assert.equal((q.label as { type: string }).type, "choice");
    assert.ok((q.label as { criteria: Record<string, string> }).criteria.billing);
  });

  it("rejects a one-option choice", () => {
    const criteria = defaultCriteria("choice");
    criteria.options = [{ id: "only", description: "one" }];
    assert.equal(validateCriteria(criteria), "Choice mode needs at least two options.");
  });
});
