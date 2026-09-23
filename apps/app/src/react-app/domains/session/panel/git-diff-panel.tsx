/** @jsxImportSource react */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";
import {
  FileMinus2,
  FilePlus2,
  FilePenLine,
  GitBranch,
  GitCommitHorizontal,
  Loader2,
  RefreshCw,
  X,
} from "lucide-react";

import type { VcsFileDiff, VcsFileStatus, VcsInfo } from "@opencode-ai/sdk/v2/client";

import type { Client } from "@/app/types";
import { unwrap } from "@/app/lib/opencode";
import { OpenworkServerError } from "@/app/lib/openwork-server";
import type {
  OpenworkGitCommit,
  OpenworkGitShowResult,
  OpenworkServerClient,
} from "@/app/lib/openwork-server";
import { formatRelativeTime } from "@/app/utils";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { DiffView } from "@/components/ui/diff-view";
import { t } from "@/i18n";

type GitDiffPanelProps = {
  /** Session the panel is bound to; its workspace is the diff root. */
  sessionId: string;
  /** OpenCode client for the session's workspace (local or mounted remote). */
  client: Client | null;
  /** OpenWork server client for the workspace — reads commit history/diffs. */
  gitClient?: OpenworkServerClient | null;
  /** Workspace id as the owning server expects it in URL paths (no `rem_`). */
  workspaceId?: string | null;
  /** Workspace root directory to diff. */
  workspaceRoot: string;
  isRemoteWorkspace?: boolean;
  /** Closes the side panel (same affordance as the artifact panel). */
  onClose: () => void;
};

type LoadState = "loading" | "ready" | "error";

type Selection = { kind: "working" } | { kind: "commit"; id: string };

/** Normalized diff row shared by the working-tree and per-commit views. */
type DiffRow = {
  file: string;
  status: "added" | "deleted" | "modified";
  additions: number;
  deletions: number;
  patch?: string;
};

const HISTORY_COMMIT_COUNT = 50;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readString(value: unknown, key: string): string | undefined {
  if (!isRecord(value)) return undefined;
  const entry = value[key];
  return typeof entry === "string" ? entry : undefined;
}

/** Any completed tool part may have touched the working tree (edit, write,
 *  apply_patch, bash/shell, MCP tools) — blanket-refresh the diff. */
function isRepoTouchingToolPart(part: unknown): boolean {
  if (!isRecord(part) || part.type !== "tool") return false;
  const state = isRecord(part.state) ? part.state : null;
  if (!state || state.status !== "completed") return false;
  const tool = isRecord(state.tool) ? state.tool : null;
  const toolName = readString(tool, "name") ?? readString(tool, "tool") ?? "";
  if (toolName) return true;
  // Some tool parts carry the tool name on the part itself.
  return Boolean(readString(part, "tool") || readString(part, "title"));
}

const EMPTY_STATUS: Record<VcsFileStatus["status"], number> = { added: 0, deleted: 0, modified: 0 };

function commitTimestamp(commit: OpenworkGitCommit): number {
  const parsed = Date.parse(commit.date);
  return Number.isFinite(parsed) ? parsed : Date.now();
}

/** Surface the actual failure (HTTP status/code/message or transport error) in
 *  the panel instead of a generic message, so a stuck load is diagnosable. */
function describeGitError(error: unknown): string {
  if (error instanceof OpenworkServerError) {
    const detail = error.message?.trim();
    return detail ? `${error.status} ${error.code}: ${detail}` : `${error.status} ${error.code}`;
  }
  if (error instanceof Error) return error.message || error.name;
  return String(error);
}

export function GitDiffPanel({
  sessionId,
  client,
  gitClient,
  workspaceId,
  workspaceRoot,
  onClose,
}: GitDiffPanelProps) {
  const [state, setState] = useState<LoadState>("loading");
  const [stateError, setStateError] = useState<string | null>(null);
  const [isRepo, setIsRepo] = useState(true);
  const [branch, setBranch] = useState<string | null>(null);
  const [files, setFiles] = useState<VcsFileStatus[]>([]);
  const [diffs, setDiffs] = useState<Record<string, VcsFileDiff>>({});
  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const [refreshVersion, setRefreshVersion] = useState(0);
  const selectedFileRef = useRef<string | null>(null);

  const [selection, setSelection] = useState<Selection>({ kind: "working" });
  const [commits, setCommits] = useState<OpenworkGitCommit[]>([]);
  const [commitsState, setCommitsState] = useState<LoadState>("ready");
  const [commitsError, setCommitsError] = useState<string | null>(null);
  const [commitShows, setCommitShows] = useState<Record<string, OpenworkGitShowResult>>({});
  const [commitLoadState, setCommitLoadState] = useState<LoadState>("ready");
  const [commitLoadError, setCommitLoadError] = useState<string | null>(null);
  const [selectedCommitFile, setSelectedCommitFile] = useState<string | null>(null);
  const commitShowsRef = useRef<Record<string, OpenworkGitShowResult>>({});
  const selectedCommitFileRef = useRef<string | null>(null);
  const commitLoadRef = useRef<string | null>(null);

  // Draggable split between the file list (top) and the diff (bottom).
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [listHeight, setListHeight] = useState<number | null>(null);
  const dragStartRef = useRef<{ startY: number; startHeight: number } | null>(null);

  const handleDividerPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    const container = containerRef.current;
    if (!container) return;
    const startHeight = listHeight ?? Math.round(container.clientHeight * 0.45);
    dragStartRef.current = { startY: event.clientY, startHeight };
    const onMove = (moveEvent: PointerEvent) => {
      const drag = dragStartRef.current;
      if (!drag) return;
      const delta = moveEvent.clientY - drag.startY;
      const min = 80;
      const max = Math.max(min + 1, container.clientHeight - 120);
      setListHeight(Math.round(Math.min(Math.max(drag.startHeight + delta, min), max)));
    };
    const onUp = () => {
      dragStartRef.current = null;
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  };

  const refresh = useCallback(() => setRefreshVersion((version) => version + 1), []);

  const load = useCallback(async () => {
    if (!client || !workspaceRoot) {
      setStateError(!client ? "OpenCode client unavailable" : "Workspace root unavailable");
      setState("error");
      return;
    }
    setState((previous) => (previous === "ready" ? "ready" : "loading"));
    try {
      const info = unwrap(await client.vcs.get({ directory: workspaceRoot })) as VcsInfo | null;
      const repo = Boolean(info && (info.branch || info.default_branch));
      if (!repo) {
        setIsRepo(false);
        setBranch(null);
        setFiles([]);
        setDiffs({});
        setStateError(null);
        setState("ready");
        return;
      }
      setIsRepo(true);
      setBranch(info?.branch ?? info?.default_branch ?? null);
      const [statusResult, diffResult] = await Promise.all([
        client.vcs.status({ directory: workspaceRoot }),
        client.vcs.diff({ directory: workspaceRoot, mode: "git" }),
      ]);
      const statusFiles = unwrap(statusResult) as VcsFileStatus[];
      const diffFiles = unwrap(diffResult) as VcsFileDiff[];
      const nextDiffs: Record<string, VcsFileDiff> = {};
      for (const entry of diffFiles) nextDiffs[entry.file] = entry;
      setFiles(statusFiles);
      setDiffs(nextDiffs);
      const preferred = selectedFileRef.current;
      setSelectedFile(
        preferred && statusFiles.some((entry) => entry.file === preferred)
          ? preferred
          : statusFiles[0]?.file ?? null,
      );
      setStateError(null);
      setState("ready");
    } catch (error) {
      setStateError(describeGitError(error));
      setState("error");
    }
  }, [client, workspaceRoot]);

  const loadCommits = useCallback(async () => {
    if (!gitClient || !workspaceId) {
      setCommits([]);
      setCommitsError(null);
      setCommitsState("ready");
      return;
    }
    setCommitsState((previous) => (previous === "ready" ? "ready" : "loading"));
    try {
      const result = await gitClient.gitLog(workspaceId, HISTORY_COMMIT_COUNT);
      if (result.ok) {
        setCommits(result.commits ?? []);
        setCommitsError(null);
        setCommitsState("ready");
      } else {
        setCommits([]);
        setCommitsError(result.message?.trim() || result.code || "request failed");
        setCommitsState(result.code === "not_a_repo" ? "ready" : "error");
      }
    } catch (error) {
      setCommits([]);
      setCommitsError(describeGitError(error));
      setCommitsState("error");
    }
  }, [gitClient, workspaceId]);

  const loadCommit = useCallback(
    async (id: string) => {
      if (!gitClient || !workspaceId) return;
      if (commitShowsRef.current[id]) return;
      commitLoadRef.current = id;
      setCommitLoadState("loading");
      setCommitLoadError(null);
      try {
        const result = await gitClient.gitShow(workspaceId, id);
        if (commitLoadRef.current !== id) return;
        if (result.ok) {
          setCommitShows((previous) => ({ ...previous, [id]: result }));
          setCommitLoadState("ready");
        } else {
          // Don't cache failures — the retry button must re-attempt the read.
          setCommitLoadState("error");
          setCommitLoadError(result.message ?? null);
        }
      } catch (error) {
        if (commitLoadRef.current !== id) return;
        setCommitLoadState("error");
        setCommitLoadError(error instanceof Error ? error.message : "git show failed");
      }
    },
    [gitClient, workspaceId],
  );

  const selectCommit = useCallback(
    (id: string) => {
      setSelection({ kind: "commit", id });
      void loadCommit(id);
    },
    [loadCommit],
  );

  useEffect(() => {
    void load();
  }, [load, refreshVersion]);

  useEffect(() => {
    void loadCommits();
  }, [loadCommits, refreshVersion]);

  // Keep refs in sync for selection/cache stability across refreshes.
  useEffect(() => {
    selectedFileRef.current = selectedFile;
  }, [selectedFile]);
  useEffect(() => {
    selectedCommitFileRef.current = selectedCommitFile;
  }, [selectedCommitFile]);
  useEffect(() => {
    commitShowsRef.current = commitShows;
  }, [commitShows]);

  // Default the selected commit's file once its diff loads.
  useEffect(() => {
    if (selection.kind !== "commit") return;
    const filesForCommit = commitShows[selection.id]?.files;
    if (!filesForCommit) return;
    const preferred = selectedCommitFileRef.current;
    setSelectedCommitFile(
      preferred && filesForCommit.some((entry) => entry.file === preferred)
        ? preferred
        : filesForCommit[0]?.file ?? null,
    );
  }, [commitShows, selection]);

  // Auto-refresh whenever the session's agent (or a subagent) completes a tool
  // call — shell commands, edits, writes, apply_patch and MCP tools can all
  // modify the working tree. Events are already scoped to this workspace's
  // engine, and subagent tool parts carry their child session id, so refresh on
  // any completed tool part rather than filtering to this exact session.
  useEffect(() => {
    if (!client) return;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | null = null;
    let mounted = true;
    void (async () => {
      try {
        const { stream } = await client.event.subscribe(undefined, { signal: controller.signal });
        for await (const event of stream) {
          if (!mounted) return;
          if (event.type !== "message.part.updated") continue;
          const properties = isRecord(event.properties) ? event.properties : null;
          const part = properties ? properties.part : null;
          if (!isRepoTouchingToolPart(part)) continue;
          if (timer) clearTimeout(timer);
          timer = setTimeout(() => {
            timer = null;
            if (mounted) refresh();
          }, 400);
        }
      } catch {
        // Stream closed or auth failed — the tab still works with manual refresh.
      }
    })();
    return () => {
      mounted = false;
      if (timer) clearTimeout(timer);
      controller.abort();
    };
  }, [client, refresh, sessionId]);

  const counts = useMemo(() => {
    const result = { ...EMPTY_STATUS };
    for (const entry of files) result[entry.status] += 1;
    return result;
  }, [files]);

  const historyAvailable = Boolean(gitClient && workspaceId);
  const selectedCommit =
    selection.kind === "commit"
      ? commits.find((commit) => commit.id === selection.id) ?? commitShows[selection.id]?.commit
      : undefined;
  const selectedShow = selection.kind === "commit" ? commitShows[selection.id] : undefined;
  const commitFiles: DiffRow[] = selectedShow?.ok
    ? (selectedShow.files ?? []).map((entry) => ({
        file: entry.file,
        status: entry.status,
        additions: entry.additions,
        deletions: entry.deletions,
        patch: entry.patch,
      }))
    : [];
  const workingRows: DiffRow[] = files.map((entry) => ({
    file: entry.file,
    status: entry.status,
    additions: entry.additions,
    deletions: entry.deletions,
    patch: diffs[entry.file]?.patch,
  }));

  const renderDiffArea = (
    rows: DiffRow[],
    selected: string | null,
    onSelect: (file: string) => void,
    emptyMessage: string,
  ) => {
    if (rows.length === 0) {
      return (
        <div className="flex min-h-0 flex-1 items-center justify-center p-6 text-center text-xs text-muted-foreground" role="status">
          <p>{emptyMessage}</p>
        </div>
      );
    }
    const selectedRow = rows.find((row) => row.file === selected);
    return (
      <div ref={containerRef} className="flex min-h-0 flex-1 flex-col">
        <div
          className="min-h-0 overflow-y-auto border-b border-border"
          style={listHeight !== null ? { height: listHeight } : { flex: "0 0 45%" }}
        >
          {rows.map((entry) => {
            const statusClass =
              entry.status === "added" ? "text-green-11" :
                entry.status === "deleted" ? "text-red-11" : "text-amber-11";
            const StatusIcon =
              entry.status === "added" ? FilePlus2 :
                entry.status === "deleted" ? FileMinus2 : FilePenLine;
            const active = entry.file === selected;
            return (
              <button
                key={entry.file}
                type="button"
                onClick={() => onSelect(entry.file)}
                className={`flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs hover:bg-muted/60 ${active ? "bg-muted/80" : ""}`}
                aria-pressed={active}
              >
                <StatusIcon className={`shrink-0 ${statusClass}`} size={14} />
                <span className="min-w-0 flex-1 truncate font-mono" title={entry.file}>{entry.file}</span>
                <span className="shrink-0 text-[10px] text-green-11">+{entry.additions}</span>
                <span className="shrink-0 text-[10px] text-red-11">−{entry.deletions}</span>
              </button>
            );
          })}
        </div>
        <div
          role="separator"
          aria-orientation="horizontal"
          onPointerDown={handleDividerPointerDown}
          className="group relative z-10 h-1.5 shrink-0 cursor-row-resize touch-none border-y border-border bg-muted/40 transition-colors hover:bg-primary/15 active:bg-primary/25"
          title="Drag to resize"
        >
          <div className="pointer-events-none absolute left-1/2 top-1/2 h-0.5 w-8 -translate-x-1/2 -translate-y-1/2 rounded-full bg-border transition-colors group-hover:bg-primary/50" />
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto p-3">
          {selectedRow?.patch ? (
            <DiffView diff={selectedRow.patch} className="max-h-full overflow-auto rounded-md font-mono text-[11px] leading-relaxed" />
          ) : (
            <p className="text-xs text-muted-foreground">{t("panel.git_diff.no_file_diff")}</p>
          )}
        </div>
      </div>
    );
  };

  const renderBody = () => {
    if (state === "loading") {
      return (
        <div className="flex flex-1 items-center justify-center gap-2 text-xs text-muted-foreground" role="status">
          <Loader2 className="animate-spin" /> {t("panel.git_diff.loading")}
        </div>
      );
    }
    if (state === "error") {
      return (
        <div className="flex flex-1 flex-col items-center justify-center gap-3 p-6 text-center text-xs text-muted-foreground" role="status">
          <p className="break-words">{t("panel.git_diff.load_failed")}{stateError ? ` ${stateError}` : ""}</p>
          <Button variant="outline" size="sm" onClick={refresh}>{t("panel.git_diff.try_again")}</Button>
        </div>
      );
    }
    if (!isRepo) {
      return (
        <div className="flex flex-1 flex-col items-center justify-center gap-2 p-6 text-center text-xs text-muted-foreground" role="status">
          <GitBranch className="opacity-50" />
          <p>{t("panel.git_diff.not_a_repo")}</p>
        </div>
      );
    }

    return (
      <div className="flex min-h-0 flex-1">
        <aside className="flex w-44 shrink-0 flex-col overflow-y-auto border-r border-border">
          <div className="px-3 pb-1 pt-2.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
            {t("panel.git_diff.changes")}
          </div>
          <button
            type="button"
            onClick={() => setSelection({ kind: "working" })}
            aria-pressed={selection.kind === "working"}
            className={`flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs hover:bg-muted/60 ${selection.kind === "working" ? "bg-muted/80" : ""}`}
          >
            <GitBranch className="shrink-0 text-muted-foreground" size={14} />
            <span className="min-w-0 flex-1 truncate">{t("panel.git_diff.working_changes")}</span>
            {files.length > 0 ? (
              <span className="shrink-0 text-[10px] tabular-nums text-muted-foreground">
                <span className="text-green-11">+{counts.added}</span>{" "}
                <span className="text-red-11">−{counts.deleted}</span>{" "}
                <span className="text-amber-11">~{counts.modified}</span>
              </span>
            ) : null}
          </button>

          <div className="px-3 pb-1 pt-2.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
            {t("panel.git_diff.commits")}
          </div>
          {!historyAvailable ? (
            <p className="px-3 py-1.5 text-xs text-muted-foreground">{t("panel.git_diff.history_unavailable")}</p>
          ) : commitsState === "loading" ? (
            <div className="flex items-center gap-2 px-3 py-2 text-xs text-muted-foreground" role="status">
              <Loader2 className="animate-spin" size={12} /> {t("panel.git_diff.loading")}
            </div>
          ) : commitsState === "error" ? (
            <div className="flex flex-col items-start gap-2 px-3 py-2 text-xs text-muted-foreground">
              <p className="break-words">{t("panel.git_diff.commits_load_failed")}{commitsError ? ` ${commitsError}` : ""}</p>
              <Button variant="outline" size="sm" onClick={() => void loadCommits()}>{t("panel.git_diff.try_again")}</Button>
            </div>
          ) : commits.length === 0 ? (
            <p className="px-3 py-1.5 text-xs text-muted-foreground">{t("panel.git_diff.no_commits")}</p>
          ) : (
            commits.map((commit) => {
              const active = selection.kind === "commit" && selection.id === commit.id;
              return (
                <button
                  key={commit.id}
                  type="button"
                  onClick={() => selectCommit(commit.id)}
                  aria-pressed={active}
                  title={commit.subject}
                  className={`block w-full px-3 py-1.5 text-left hover:bg-muted/60 ${active ? "bg-muted/80" : ""}`}
                >
                  <span className="flex w-full items-center gap-1.5">
                    <GitCommitHorizontal className="shrink-0 text-muted-foreground" size={13} />
                    <span className="min-w-0 flex-1 truncate text-xs">{commit.subject}</span>
                  </span>
                  <span className="mt-0.5 flex w-full items-center gap-1 pl-[19px] text-[10px] text-muted-foreground">
                    <span className="shrink-0 font-mono">{commit.short}</span>
                    <span className="min-w-0 flex-1 truncate">{commit.author}</span>
                    <span className="shrink-0">{formatRelativeTime(commitTimestamp(commit))}</span>
                  </span>
                </button>
              );
            })
          )}
        </aside>

        <div className="flex min-h-0 flex-1 flex-col">
          <div className="shrink-0 border-b border-border px-3 py-2">
            {selection.kind === "working" ? (
              <div className="flex items-center gap-2">
                <span className="min-w-0 flex-1 truncate text-xs font-medium">{t("panel.git_diff.working_changes")}</span>
                {files.length > 0 ? (
                  <span className="shrink-0 text-[10px] tabular-nums text-muted-foreground">
                    <span className="text-green-11">+{counts.added}</span>{" "}
                    <span className="text-red-11">−{counts.deleted}</span>{" "}
                    <span className="text-amber-11">~{counts.modified}</span>
                  </span>
                ) : null}
              </div>
            ) : (
              <div className="min-w-0">
                <p className="truncate text-xs font-medium">{selectedCommit?.subject ?? selection.id}</p>
                <p className="mt-0.5 truncate text-[10px] text-muted-foreground">
                  {selectedCommit
                    ? `${selectedCommit.short} · ${selectedCommit.author} · ${formatRelativeTime(commitTimestamp(selectedCommit))}`
                    : ""}
                </p>
              </div>
            )}
          </div>

          {selection.kind === "working" ? (
            renderDiffArea(
              workingRows,
              selectedFile,
              setSelectedFile,
              t("panel.git_diff.clean"),
            )
          ) : commitLoadState === "loading" ? (
            <div className="flex min-h-0 flex-1 items-center justify-center gap-2 text-xs text-muted-foreground" role="status">
              <Loader2 className="animate-spin" /> {t("panel.git_diff.loading")}
            </div>
          ) : commitLoadState === "error" ? (
            <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-3 p-6 text-center text-xs text-muted-foreground" role="status">
              <p>{t("panel.git_diff.commit_load_failed")}{commitLoadError ? ` ${commitLoadError}` : ""}</p>
              <Button variant="outline" size="sm" onClick={() => void loadCommit(selection.id)}>{t("panel.git_diff.try_again")}</Button>
            </div>
          ) : (
            renderDiffArea(
              commitFiles,
              selectedCommitFile,
              setSelectedCommitFile,
              selectedShow?.truncated ? t("panel.git_diff.commit_diff_too_large") : t("panel.git_diff.no_commit_changes"),
            )
          )}
        </div>
      </div>
    );
  };

  return (
    <div className="flex h-full min-h-0 flex-col" data-git-diff-panel>
      <div className="flex items-center gap-2 border-b border-border px-3 py-2">
        <GitBranch className="shrink-0 text-muted-foreground" size={14} />
        <span className="min-w-0 flex-1 truncate text-xs font-medium">
          {branch ?? t("panel.git_diff.title")}
        </span>
        <Tooltip>
          <TooltipTrigger render={(
            <Button variant="ghost" size="icon-sm" onClick={refresh} aria-label={t("panel.git_diff.refresh")} disabled={state === "loading"}>
              <RefreshCw className={state === "loading" ? "animate-spin" : undefined} />
            </Button>
          )} />
          <TooltipContent>{t("panel.git_diff.refresh")}</TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger render={(
            <Button variant="ghost" size="icon-sm" onClick={onClose} aria-label={t("panel.git_diff.close_panel")}>
              <X />
            </Button>
          )} />
          <TooltipContent>{t("panel.git_diff.close")}</TooltipContent>
        </Tooltip>
      </div>
      {renderBody()}
    </div>
  );
}
