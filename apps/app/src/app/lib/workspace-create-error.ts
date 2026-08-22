import { OpenworkServerError } from "./openwork-server";

/**
 * Map a failed workspace-creation call to a user-facing message. The server's
 * structured errors already explain the failure (e.g. "folderPath must be an
 * absolute path on this server" or "Could not create workspace folder at /x:
 * permission denied"); anything else falls back to the raw error text.
 */
export function describeCreateWorkspaceError(error: unknown): string {
  if (error instanceof OpenworkServerError) {
    return error.message;
  }
  if (error instanceof Error) return error.message;
  if (typeof error === "string" && error.trim()) return error;
  return "Could not create the workspace.";
}
