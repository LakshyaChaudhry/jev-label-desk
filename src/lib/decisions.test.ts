import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { isOpenRouterApiKey, normalizeOpenRouterApiKey } from "./decisions";

describe("OpenRouter API key", () => {
  it("trims whitespace before validating", () => {
    assert.equal(normalizeOpenRouterApiKey("  sk-or-v1-abc  "), "sk-or-v1-abc");
  });

  it("accepts OpenRouter-shaped keys", () => {
    assert.equal(isOpenRouterApiKey("sk-or-v1-abc123"), true);
    assert.equal(isOpenRouterApiKey("sk-abc_DEF-9"), true);
  });

  it("rejects empty or non-OpenRouter strings", () => {
    assert.equal(isOpenRouterApiKey(""), false);
    assert.equal(isOpenRouterApiKey("not-a-key"), false);
    assert.equal(isOpenRouterApiKey("Bearer sk-or-v1-abc"), false);
    assert.equal(isOpenRouterApiKey("sk-or-v1-abc!"), false);
  });
});
