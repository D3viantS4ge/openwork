import type { FilePartInput } from "@opencode-ai/sdk/v2/client";

import { isWindowsPlatform } from "@/app/utils";

const FIRST_LINE_LOCAL_PATH_RE = /(?:file:\/\/[^\s"'`<>]+|~\/[^\s"'`<>]+|[A-Za-z]:[\\/][^\s"'`<>]+|(?<![:/])\/[A-Za-z0-9._~+%/-]*[\/.][A-Za-z0-9._~+%/-]*)/g;
const TRAILING_PUNCTUATION_RE = /[),.;:]+$/;

function stripTrailingPunctuation(value: string) {
  return value.replace(TRAILING_PUNCTUATION_RE, "");
}

function hasPathBoundary(line: string, start: number) {
  if (start <= 0) return true;
  return /[\s("'[]/.test(line[start - 1] ?? "");
}

function safeDecodeURIComponent(value: string) {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function normalizeFileUri(value: string) {
  try {
    const parsed = new URL(value);
    if (parsed.protocol !== "file:") return "";
    const pathname = safeDecodeURIComponent(parsed.pathname);
    if (!pathname) return "";
    if (parsed.hostname && parsed.hostname.toLowerCase() !== "localhost") {
      return `//${parsed.hostname}${pathname}`;
    }
    return pathname;
  } catch {
    return "";
  }
}

function homeFromWorkspaceRoot(workspaceRoot: string) {
  const normalized = workspaceRoot.trim().replace(/\\/g, "/");
  const macMatch = normalized.match(/^(\/Users\/[^/]+)(?:\/|$)/);
  if (macMatch) return macMatch[1] ?? "";
  const linuxMatch = normalized.match(/^(\/home\/[^/]+)(?:\/|$)/);
  if (linuxMatch) return linuxMatch[1] ?? "";
  return "";
}

function toAbsolutePath(value: string, workspaceRoot: string) {
  if (/^file:\/\//i.test(value)) return normalizeFileUri(value);
  if (value.startsWith("~/")) {
    const home = homeFromWorkspaceRoot(workspaceRoot);
    return home ? `${home}/${value.slice(2)}` : "";
  }
  if (value.startsWith("/")) {
    // POSIX absolute paths are not absolute on Windows (e.g. WSL paths like
    // /mnt/c); emitting them as file parts crashes the engine's
    // fileURLToPath and the prompt fails to send.
    return isWindowsPlatform() ? "" : value;
  }
  if (/^[A-Za-z]:[\\/]/.test(value)) return value.replace(/\\/g, "/");
  return "";
}

function filenameFromPath(value: string) {
  const normalized = value.replace(/\\/g, "/");
  const segments = normalized.split("/").filter(Boolean);
  return segments[segments.length - 1] ?? "file";
}

function encodeFilePath(path: string) {
  return path.replace(/\\/g, "/").split("/").map(encodeURIComponent).join("/");
}

export function toFileUrl(path: string) {
  const normalized = path.replace(/\\/g, "/");
  if (!normalized) return "";
  if (/^[A-Za-z]:\//.test(normalized)) return `file:///${encodeFilePath(normalized).replace(/^([A-Za-z])%3A/, "$1:")}`;
  return `file://${encodeFilePath(normalized)}`;
}

/**
 * A file part URL is only safe to emit when it is a valid absolute file URL
 * on the platform that will resolve it — the opencode engine, which runs on
 * the workspace server (not necessarily the browser's platform: a Windows
 * browser talking to a WSL2/Linux server must emit POSIX paths). POSIX-style
 * paths (/mnt/c, /Users/...) are absolute on Linux/macOS but not on Windows —
 * the engine's fileURLToPath throws on them and the whole prompt fails to
 * send. Returns false for anything the engine could not resolve.
 *
 * `engineIsWindows` defaults to the browser platform for callers that have no
 * server platform available (first-line path inference); send paths that know
 * the workspace server's platform pass it explicitly.
 */
export function isValidLocalFileUrl(url: string, engineIsWindows: boolean = isWindowsPlatform()): boolean {
  if (!url) return false;
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "file:") return false;
    const pathname = parsed.pathname;
    if (!pathname.startsWith("/")) return false;
    if (engineIsWindows) {
      // Windows absolute paths are drive-letter (file:///C:/... — possibly
      // percent-encoded as /C%3A/...) or UNC (file://server/share ->
      // pathname //server/share).
      const decoded = safeDecodeURIComponent(pathname);
      return /^\/[A-Za-z]:\//.test(decoded) || decoded.startsWith("//");
    }
    return true;
  } catch {
    return false;
  }
}

export function joinWorkspaceRelativePath(workspaceRoot: string, relativePath: string) {
  const root = workspaceRoot.trim().replace(/\\/g, "/").replace(/\/+$/, "");
  const relative = relativePath.trim().replace(/\\/g, "/").replace(/^\/+/, "");
  if (!root || !relative) return "";
  return `${root}/${relative}`;
}

export function firstLineLocalFileParts(text: string, workspaceRoot: string): FilePartInput[] {
  const firstLine = text.split(/\r?\n/, 1)[0] ?? "";
  const parts: FilePartInput[] = [];
  const seen = new Set<string>();

  for (const match of firstLine.matchAll(FIRST_LINE_LOCAL_PATH_RE)) {
    if (!hasPathBoundary(firstLine, match.index ?? 0)) continue;
    const raw = stripTrailingPunctuation(match[0]);
    const absolute = toAbsolutePath(raw, workspaceRoot);
    if (!absolute || seen.has(absolute)) continue;
    seen.add(absolute);
    // Never emit a part the engine could not resolve: an invalid file URL
    // crashes fileURLToPath and the prompt fails to send. Tokens that do
    // not map to a valid absolute file URL on this platform are skipped —
    // the prompt still sends, with the path left as plain text.
    const url = toFileUrl(absolute);
    if (!url || !isValidLocalFileUrl(url)) continue;
    parts.push({
      type: "file",
      mime: "text/plain",
      url,
      filename: filenameFromPath(raw),
    });
  }

  return parts;
}
