import { describe, expect, test } from "bun:test"
import { workflowsEnabled } from "../src/capability-sources/workflow-rollout.js"

describe("workflowsEnabled", () => {
  test("uses workflows before the legacy codemodeScripts key", () => {
    expect(workflowsEnabled({ capabilities: { workflows: true } })).toBe(true)
    expect(workflowsEnabled(JSON.stringify({ capabilities: { workflows: true } }))).toBe(true)
    expect(workflowsEnabled({ capabilities: { codemodeScripts: true } })).toBe(true)
    expect(workflowsEnabled({ capabilities: { workflows: false, codemodeScripts: true } })).toBe(false)
    expect(workflowsEnabled({ capabilities: { workflows: true, codemodeScripts: false } })).toBe(true)
    expect(workflowsEnabled({ capabilities: { workflows: "invalid", codemodeScripts: true } })).toBe(false)
    expect(workflowsEnabled({ capabilities: { workflows: null, codemodeScripts: true } })).toBe(false)
  })

  test("is disabled for absent, false, legacy flat, malformed, and non-boolean values", () => {
    for (const metadata of [
      null,
      undefined,
      {},
      { capabilities: { codemodeScripts: false } },
      { codemodeScripts: true },
      "not json",
      "true",
      '{"capabilities":{"codemodeScripts":true}',
      JSON.stringify({ codemodeScripts: true }),
      JSON.stringify({ capabilities: { codemodeScripts: "true" } }),
    ]) {
      expect(workflowsEnabled(metadata)).toBe(false)
    }
  })
})
