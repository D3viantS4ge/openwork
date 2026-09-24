import { execFile } from "node:child_process";
import { promisify } from "node:util";

import type { ServerConfig, WorkspaceInfo } from "../types.js";
import { addRoute, type RequestContext, type Route } from "./registry.js";

/**
 * Read-only git history routes for the Git Diff side-panel tab.
 *
 * The OpenWork server that serves a workspace owns the workspace files on its
 * own filesystem (`workspace.path`), for both local workspaces (the user's
 * local server) and remote workspaces (the hosting worker) — the same access
 * the file routes use. These routes run read-only `git` commands in
 * `workspace.path` and return structured commit/diff data. They deliberately
 * avoid modifying the repo and never take user-controlled commands: every
 * argument is a fixed argv entry and `ref` is validated to a hex commit id.
 *
 * The engine daemon has its own vcs surface for the working tree; these routes
 * cover the commit history (`git log`) and per-commit diffs (`git show`) that
 * the engine does not expose.
 *
 * Keep the URL shapes free of analytics-looking signatures: `/git/commits`
 * (not `/git/log`) with `?limit=` (not `?count=`), and the commit id as a path
 * segment (not `?ref=`). Browser content blockers match shapes like
 * `/log?count=` or tracking parameters such as `ref`, which silently blocks
 * these requests before they leave the page.
 */

const execFileAsync = promisify(execFile);

const GIT_MAX_OUTPUT_BYTES = 5 * 1024 * 1024;
const GIT_SMALL_MAX_BYTES = 1024 * 1024;
const LOG_MAX_COMMITS = 200;
const LOG_DEFAULT_COMMITS = 50;
/** The empty tree object (stable git SHA-1) used to diff a root commit. */
const EMPTY_TREE_HASH = "4b825dc642cb6eb9a060e54bf8d69288fbee4904";
const LOG_PRETTY = "%H%x1f%h%x1f%an%x1f%ae%x1f%aI%x1f%s%x1f%P";
const REF_RE = /^[0-9a-fA-F]{7,64}$/;

type CommitRecord = {
  id: string;
  short: string;
  author: string;
  email: string;
  date: string;
  subject: string;
  parents: string[];
};

type NameStatusItem = { file: string; code: string };

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Git command failed.";
}

function isMaxBufferError(error: unknown): boolean {
  return Boolean(
    error && typeof error === "object" && "code" in error &&
      (error as { code?: unknown }).code === "ERR_CHILD_PROCESS_STDIO_MAXBUFFER",
  );
}

async function runGit(workspacePath: string, args: string[], maxBuffer = GIT_MAX_OUTPUT_BYTES): Promise<string> {
  const { stdout } = await execFileAsync("git", args, {
    cwd: workspacePath,
    encoding: "utf8",
    maxBuffer,
    windowsHide: true,
  });
  return stdout;
}

async function isGitRepo(workspacePath: string): Promise<boolean> {
  try {
    const { stdout } = await execFileAsync(
      "git",
      ["rev-parse", "--is-inside-work-tree"],
      { cwd: workspacePath, encoding: "utf8", maxBuffer: GIT_SMALL_MAX_BYTES, windowsHide: true },
    );
    return stdout.trim() === "true";
  } catch {
    return false;
  }
}

async function hasHead(workspacePath: string): Promise<boolean> {
  try {
    const { stdout } = await execFileAsync(
      "git",
      ["rev-parse", "--verify", "--quiet", "HEAD"],
      { cwd: workspacePath, encoding: "utf8", maxBuffer: GIT_SMALL_MAX_BYTES, windowsHide: true },
    );
    return stdout.trim().length > 0;
  } catch {
    return false;
  }
}

function parseLogRecords(output: string): CommitRecord[] {
  return output
    .split("\0")
    .map((record) => record.trim())
    .filter(Boolean)
    .flatMap((record) => {
      const [id, short, author, email, date, subject, parents = ""] = record.split("\x1f");
      if (!id) return [];
      return [{
        id,
        short: short ?? "",
        author: author ?? "",
        email: email ?? "",
        date: date ?? "",
        subject: subject ?? "",
        parents: parents ? parents.split(" ").filter(Boolean) : [],
      } satisfies CommitRecord];
    });
}

function parseNameStatus(output: string): NameStatusItem[] {
  const parts = output.split("\0").filter(Boolean);
  const items: NameStatusItem[] = [];
  for (let index = 0; index + 1 < parts.length; index += 2) {
    const code = parts[index];
    const file = parts[index + 1];
    if (!code || !file) continue;
    items.push({ file, code });
  }
  return items;
}

function parseNumstat(output: string): Map<string, { additions: number; deletions: number }> {
  const map = new Map<string, { additions: number; deletions: number }>();
  for (const record of output.split("\0").filter(Boolean)) {
    const firstTab = record.indexOf("\t");
    const secondTab = record.indexOf("\t", firstTab + 1);
    if (firstTab === -1 || secondTab === -1) continue;
    const adds = record.slice(0, firstTab);
    const dels = record.slice(firstTab + 1, secondTab);
    const file = record.slice(secondTab + 1);
    if (!file) continue;
    const additions = adds === "-" ? 0 : Number.parseInt(adds || "0", 10);
    const deletions = dels === "-" ? 0 : Number.parseInt(dels || "0", 10);
    map.set(file, {
      additions: Number.isFinite(additions) ? additions : 0,
      deletions: Number.isFinite(deletions) ? deletions : 0,
    });
  }
  return map;
}

function splitGitPatch(patch: string): string[] {
  const starts = [...patch.matchAll(/(?:^|\n)diff --git /g)].map((match) =>
    match[0].startsWith("\n") ? match.index + 1 : match.index,
  );
  return starts.map((start, index) => patch.slice(start, starts[index + 1] ?? patch.length));
}

function statusFromCode(code: string): "added" | "deleted" | "modified" {
  if (code === "A" || code === "??") return "added";
  if (code === "D") return "deleted";
  return "modified";
}

function parseCommitLimit(raw: string | null): number {
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) return LOG_DEFAULT_COMMITS;
  return Math.min(Math.floor(parsed), LOG_MAX_COMMITS);
}

export interface RegisterGitRoutesOptions {
  routes: Route[];
  config: ServerConfig;
  jsonResponse: (data: unknown, status?: number) => Response;
  resolveWorkspace: (config: ServerConfig, id: string) => Promise<WorkspaceInfo>;
}

export function registerGitRoutes(options: RegisterGitRoutesOptions): void {
  const { routes, config, jsonResponse, resolveWorkspace } = options;

  addRoute(routes, "GET", "/workspace/:id/git/commits", "client", async (ctx: RequestContext) => {
    const workspace = await resolveWorkspace(config, ctx.params.id);
    if (!(await isGitRepo(workspace.path))) {
      return jsonResponse({ ok: false, code: "not_a_repo" });
    }
    const count = parseCommitLimit(ctx.url.searchParams.get("limit"));

    let branch = "";
    try {
      branch = (await runGit(workspace.path, ["branch", "--show-current"], GIT_SMALL_MAX_BYTES)).trim();
    } catch {
      branch = "";
    }

    if (!(await hasHead(workspace.path))) {
      return jsonResponse({ ok: true, branch: branch || null, commits: [] });
    }

    try {
      const output = await runGit(workspace.path, [
        "log",
        `--pretty=tformat:${LOG_PRETTY}`,
        "-z",
        "-n",
        String(count),
        "HEAD",
      ]);
      return jsonResponse({ ok: true, branch: branch || null, commits: parseLogRecords(output) });
    } catch (error) {
      return jsonResponse({ ok: false, code: "git_failed", message: errorMessage(error) });
    }
  });

  addRoute(routes, "GET", "/workspace/:id/git/commit/:ref", "client", async (ctx: RequestContext) => {
    const workspace = await resolveWorkspace(config, ctx.params.id);
    const ref = (ctx.params.ref ?? "").trim();
    if (!REF_RE.test(ref)) {
      return jsonResponse({ ok: false, code: "invalid_ref", message: "Invalid commit reference." });
    }
    if (!(await isGitRepo(workspace.path))) {
      return jsonResponse({ ok: false, code: "not_a_repo" });
    }

    let commit: CommitRecord | undefined;
    try {
      const logOutput = await runGit(workspace.path, ["log", "-1", `--pretty=tformat:${LOG_PRETTY}`, ref]);
      commit = parseLogRecords(logOutput)[0];
    } catch (error) {
      // A ref that cannot be read in this repo (stale or unknown) is the
      // expected failure here; the app only passes refs from `git log`.
      return jsonResponse({ ok: false, code: "invalid_ref", message: errorMessage(error) });
    }
    if (!commit) {
      return jsonResponse({ ok: false, code: "invalid_ref", message: "Commit not found." });
    }

    // Diff against the first parent so root commits (no parent) and merges both
    // produce clean per-file `diff --git` output (merges show their first-parent
    // diff, like the engine's working-tree surface).
    const base = commit.parents[0] ?? EMPTY_TREE_HASH;

    let items: NameStatusItem[] = [];
    let stats = new Map<string, { additions: number; deletions: number }>();
    try {
      const [nameStatusOut, numstatOut] = await Promise.all([
        runGit(workspace.path, ["diff", "--no-ext-diff", "--no-renames", "--name-status", "-z", base, ref, "--", "."]),
        runGit(workspace.path, ["diff", "--no-ext-diff", "--no-renames", "--numstat", "-z", base, ref, "--", "."]),
      ]);
      items = parseNameStatus(nameStatusOut);
      stats = parseNumstat(numstatOut);
    } catch (error) {
      return jsonResponse({ ok: false, code: "git_failed", message: errorMessage(error) });
    }

    let patchText = "";
    let truncated = false;
    try {
      patchText = await runGit(workspace.path, ["diff", "--no-ext-diff", "--no-renames", "--unified=3", base, ref, "--", "."]);
    } catch (error) {
      if (!isMaxBufferError(error)) {
        return jsonResponse({ ok: false, code: "git_failed", message: errorMessage(error) });
      }
      truncated = true;
    }

    const chunks = splitGitPatch(patchText);
    const files = items.map((item, index) => {
      const stat = stats.get(item.file) ?? { additions: 0, deletions: 0 };
      return {
        file: item.file,
        additions: stat.additions,
        deletions: stat.deletions,
        status: statusFromCode(item.code),
        patch: chunks[index] ?? "",
      };
    });

    return jsonResponse({ ok: true, commit, files, truncated });
  });
}
