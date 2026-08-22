import { useDesktopConfig } from "@/react-app/domains/cloud/desktop-config-provider"

/**
 * Deployment-level Automation availability advertised by Den.
 *
 * Older Den versions and stale cached configs omit the field. Treat both as
 * disabled so self-deployed installations and startup stay fail-closed.
 */
export function useAutomationDeploymentEnabled() {
  const { config, loading } = useDesktopConfig()
  return !loading && config.automationsEnabled === true
}
