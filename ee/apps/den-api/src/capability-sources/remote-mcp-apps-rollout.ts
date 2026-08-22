import { organizationHasCapability } from "../organization-capabilities.js"

type MetadataInput = Record<string, unknown> | string | null | undefined

/**
 * Native and currently published imported MCP Apps require both an operator
 * deployment opt-in and an explicit per-organization opt-in. Either gate can
 * fail the rollout closed. Native App metadata is additionally published only
 * to clients that explicitly advertise support for the private App host, so
 * the Den foundation can safely ship before its matching Desktop consumer.
 */
export function remoteMcpAppsEnabled(
  metadata: MetadataInput,
  options: { deploymentEnabled: boolean },
): boolean {
  return options.deploymentEnabled && organizationHasCapability(metadata, "remoteMcpApps")
}
