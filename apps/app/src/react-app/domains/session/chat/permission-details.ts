import { t } from "@/i18n";
import type { PendingPermission } from "@/app/types";

export type PermissionDetail = {
  label: string;
  value: string;
  multiline?: boolean;
};

const metadataDetailKeys: Array<{ key: string; labelKey: string; multiline?: boolean }> = [
  { key: "command", labelKey: "session.permission_detail_command", multiline: true },
  { key: "description", labelKey: "session.permission_detail_description" },
  { key: "cwd", labelKey: "session.permission_detail_cwd" },
  { key: "filepath", labelKey: "session.permission_detail_file" },
  { key: "filePath", labelKey: "session.permission_detail_file" },
  { key: "path", labelKey: "session.permission_detail_path" },
  { key: "target", labelKey: "session.permission_detail_target" },
  { key: "parentDir", labelKey: "session.permission_detail_parent_directory" },
  { key: "url", labelKey: "session.permission_detail_url" },
  { key: "query", labelKey: "session.permission_detail_query", multiline: true },
  { key: "subagent_type", labelKey: "session.permission_detail_agent" },
  { key: "tool", labelKey: "session.permission_detail_tool" },
  { key: "files", labelKey: "session.permission_detail_files", multiline: true },
  { key: "diff", labelKey: "session.permission_detail_diff", multiline: true },
];

function fileChangeLine(value: unknown): string | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  const path =
    (typeof record.relativePath === "string" && record.relativePath.trim()) ||
    (typeof record.filePath === "string" && record.filePath.trim()) ||
    (typeof record.path === "string" && record.path.trim()) ||
    null;
  if (!path) return null;
  const type = typeof record.type === "string" && record.type.trim() ? record.type.trim() : "change";
  return `${type}: ${path}`;
}

function metadataValue(key: string, value: unknown): string | null {
  if (typeof value === "string") return value.trim() || null;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (key === "files" && Array.isArray(value)) {
    const lines = value.flatMap((item) => {
      const line = fileChangeLine(item);
      return line ? [line] : [];
    });
    return lines.length ? lines.join("\n") : null;
  }
  return null;
}

export function permissionDetailRows(metadata: Record<string, unknown>): PermissionDetail[] {
  const seen = new Set<string>();
  const rows: PermissionDetail[] = [];
  for (const item of metadataDetailKeys) {
    if (seen.has(item.labelKey)) continue;
    const value = metadataValue(item.key, metadata[item.key]);
    if (!value) continue;
    seen.add(item.labelKey);
    rows.push({
      label: t(item.labelKey),
      value,
      multiline: item.multiline,
    });
  }
  return rows;
}

/**
 * Merge a tool call's arguments into a permission's review metadata when the
 * engine supplied no details of its own. Custom MCP tools ask with empty
 * metadata (their arguments are the only reviewable detail), while built-in
 * tools keep their richer engine metadata untouched. Engine keys win on
 * conflicts.
 */
export function permissionWithToolInputDetails(
  permission: PendingPermission | null,
  toolInput: Record<string, unknown> | null,
): PendingPermission | null {
  if (!permission || !toolInput || Object.keys(toolInput).length === 0) return permission;
  if (permissionDetailRows(permission.metadata).length > 0) return permission;
  return { ...permission, metadata: { ...toolInput, ...permission.metadata } };
}
