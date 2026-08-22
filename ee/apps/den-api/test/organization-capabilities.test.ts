import { describe, expect, test } from "bun:test"
import {
  normalizeOrganizationCapabilities,
  organizationHasCapability,
  readOrganizationCapabilityOverrides,
} from "../src/organization-capabilities.js"

const defaultCapabilities = { installLinks: false, mcpConnections: false, workflows: false, remoteMcpApps: false, cloud: false }

describe("normalizeOrganizationCapabilities", () => {
  test("defaults every capability to false when metadata is empty", () => {
    expect(normalizeOrganizationCapabilities(null)).toEqual(defaultCapabilities)
    expect(normalizeOrganizationCapabilities(undefined)).toEqual(defaultCapabilities)
    expect(normalizeOrganizationCapabilities({})).toEqual(defaultCapabilities)
    expect(normalizeOrganizationCapabilities("")).toEqual(defaultCapabilities)
  })

  test("reads an explicit opt-in from record metadata", () => {
    expect(normalizeOrganizationCapabilities({ capabilities: { installLinks: true } })).toEqual({ ...defaultCapabilities, installLinks: true })
    expect(normalizeOrganizationCapabilities({ capabilities: { mcpConnections: true } })).toEqual({ ...defaultCapabilities, mcpConnections: true })
    expect(normalizeOrganizationCapabilities({ capabilities: { workflows: true } })).toEqual({ ...defaultCapabilities, workflows: true })
    expect(normalizeOrganizationCapabilities({ capabilities: { codemodeScripts: true } })).toEqual({ ...defaultCapabilities, workflows: true })
    expect(normalizeOrganizationCapabilities({ capabilities: { workflows: false, codemodeScripts: true } })).toEqual(defaultCapabilities)
    expect(normalizeOrganizationCapabilities({ capabilities: { workflows: true, codemodeScripts: false } })).toEqual({ ...defaultCapabilities, workflows: true })
    expect(normalizeOrganizationCapabilities({ capabilities: { workflows: "invalid", codemodeScripts: true } })).toEqual(defaultCapabilities)
    expect(normalizeOrganizationCapabilities({ capabilities: { workflows: null, codemodeScripts: true } })).toEqual(defaultCapabilities)
    expect(normalizeOrganizationCapabilities({ capabilities: { remoteMcpApps: true } })).toEqual({ ...defaultCapabilities, remoteMcpApps: true })
    expect(normalizeOrganizationCapabilities({ capabilities: { cloud: true } })).toEqual({ ...defaultCapabilities, cloud: true })
    expect(normalizeOrganizationCapabilities({ capabilities: { installLinks: false, mcpConnections: false } })).toEqual(defaultCapabilities)
  })

  test("reads an explicit opt-in from JSON string metadata", () => {
    expect(normalizeOrganizationCapabilities(JSON.stringify({ capabilities: { installLinks: true, mcpConnections: true, workflows: true, remoteMcpApps: true, cloud: true } }))).toEqual({ installLinks: true, mcpConnections: true, workflows: true, remoteMcpApps: true, cloud: true })
  })

  test("treats anything but literal true as off", () => {
    expect(normalizeOrganizationCapabilities({ capabilities: { installLinks: "true", mcpConnections: "true", cloud: "true" } })).toEqual(defaultCapabilities)
    expect(normalizeOrganizationCapabilities({ capabilities: { installLinks: 1, mcpConnections: 1, cloud: 1 } })).toEqual(defaultCapabilities)
    expect(normalizeOrganizationCapabilities({ capabilities: null })).toEqual(defaultCapabilities)
    expect(normalizeOrganizationCapabilities({ capabilities: [] })).toEqual(defaultCapabilities)
    expect(normalizeOrganizationCapabilities("not json")).toEqual(defaultCapabilities)
  })

  test("ignores unrelated metadata keys", () => {
    const metadata = {
      limits: { members: 5, workers: 1 },
      plan: { tier: "enterprise", source: "manual" },
      capabilities: { installLinks: true, mcpConnections: true, cloud: true },
    }
    expect(normalizeOrganizationCapabilities(metadata)).toEqual({ ...defaultCapabilities, installLinks: true, mcpConnections: true, cloud: true })
  })
})

describe("readOrganizationCapabilityOverrides", () => {
  test("leaves absent capability keys absent", () => {
    expect(readOrganizationCapabilityOverrides(null)).toEqual({})
    expect(readOrganizationCapabilityOverrides({})).toEqual({})
    expect(readOrganizationCapabilityOverrides({ capabilities: {} })).toEqual({})
  })

  test("preserves explicit boolean false overrides", () => {
    expect(readOrganizationCapabilityOverrides({ capabilities: { installLinks: false, mcpConnections: false, workflows: false, cloud: false } })).toEqual({ installLinks: false, mcpConnections: false, workflows: false, cloud: false })
    expect(readOrganizationCapabilityOverrides({ capabilities: { codemodeScripts: true } })).toEqual({ workflows: true })
  })

  test("gives the canonical key precedence for conflicts and malformed values", () => {
    expect(readOrganizationCapabilityOverrides({ capabilities: { workflows: false, codemodeScripts: true } })).toEqual({ workflows: false })
    expect(readOrganizationCapabilityOverrides({ capabilities: { workflows: true, codemodeScripts: false } })).toEqual({ workflows: true })
    expect(readOrganizationCapabilityOverrides({ capabilities: { workflows: "invalid", codemodeScripts: true } })).toEqual({})
    expect(readOrganizationCapabilityOverrides(JSON.stringify({ capabilities: { workflows: null, codemodeScripts: true } }))).toEqual({})
  })

  test("normalizes precedence-sensitive overrides consistently with the full capability view", () => {
    for (const metadata of [
      { capabilities: { workflows: false, codemodeScripts: true } },
      { capabilities: { workflows: true, codemodeScripts: false } },
      { capabilities: { workflows: "invalid", codemodeScripts: true } },
      { capabilities: { workflows: null, codemodeScripts: true } },
    ]) {
      expect({ ...defaultCapabilities, ...readOrganizationCapabilityOverrides(metadata) }).toEqual(normalizeOrganizationCapabilities(metadata))
    }
  })

  test("ignores unrelated and non-boolean metadata", () => {
    expect(readOrganizationCapabilityOverrides({
      limits: { members: 10 },
      plan: { tier: "enterprise" },
      capabilities: { installLinks: "true", mcpConnections: 1, cloud: "true", otherCapability: true },
    })).toEqual({})
  })

  test("reads explicit overrides from JSON metadata", () => {
    expect(readOrganizationCapabilityOverrides(JSON.stringify({ capabilities: { installLinks: true, mcpConnections: false, cloud: true } }))).toEqual({ installLinks: true, mcpConnections: false, cloud: true })
  })
})

describe("organizationHasCapability", () => {
  test("is false by default and true only with an explicit opt-in", () => {
    expect(organizationHasCapability(null, "installLinks")).toBe(false)
    expect(organizationHasCapability(null, "mcpConnections")).toBe(false)
    expect(organizationHasCapability(null, "cloud")).toBe(false)
    expect(organizationHasCapability(null, "remoteMcpApps")).toBe(false)
    expect(organizationHasCapability({ capabilities: {} }, "installLinks")).toBe(false)
    expect(organizationHasCapability({ capabilities: {} }, "mcpConnections")).toBe(false)
    expect(organizationHasCapability({ capabilities: {} }, "cloud")).toBe(false)
    expect(organizationHasCapability({ capabilities: { installLinks: true } }, "installLinks")).toBe(true)
    expect(organizationHasCapability({ capabilities: { mcpConnections: true } }, "mcpConnections")).toBe(true)
    expect(organizationHasCapability({ capabilities: { cloud: true } }, "cloud")).toBe(true)
    expect(organizationHasCapability({ capabilities: { remoteMcpApps: true } }, "remoteMcpApps")).toBe(true)
    expect(organizationHasCapability(JSON.stringify({ capabilities: { installLinks: true } }), "installLinks")).toBe(true)
    expect(organizationHasCapability(JSON.stringify({ capabilities: { mcpConnections: true } }), "mcpConnections")).toBe(true)
    expect(organizationHasCapability(JSON.stringify({ capabilities: { cloud: true } }), "cloud")).toBe(true)
  })
})
