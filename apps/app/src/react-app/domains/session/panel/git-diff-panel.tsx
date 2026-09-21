/** @jsxImportSource react */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";
import {
  FileMinus2,
  FilePlus2,
  FilePenLine,
  GitBranch,
  Loader2,
  RefreshCw,
} from "lucide-react";

import type { VcsFileDiff, VcsFileStatus, VcsInfo } from "@opencode-ai/sdk/v2/client";

import type { Client } from "@/app/types";
import { unwrap } from "@/app/lib/opencode";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { DiffView } from "@/components/ui/diff-view";

type GitDiffPanelProps = {
  /** Session the panel is bound to; its workspace is the diff root. */
  sessionId: string;
  /** OpenCode client for the session's workspace (local or mounted remote). */
  client: Client | null;
  /** Workspace root directory to diff. */
  workspaceRoot: string;
  isRemoteWorkspace?: boolean;
};

type LoadState = "loading" | "ready" | "error";

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

export function GitDiffPanel({ sessionId, client, workspaceRoot }: GitDiffPanelProps) {
  const [state, setState] = useState<LoadState>("loading");
  const [isRepo, setIsRepo] = useState(true);
  const [branch, setBranch] = useState<string | null>(null);
  const [files, setFiles] = useState<VcsFileStatus[]>([]);
  const [diffs, setDiffs] = useState<Record<string, VcsFileDiff>>({});
  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const [refreshVersion, setRefreshVersion] = useState(0);
  const selectedFileRef = useRef<string | null>(null);
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
      setState("ready");
    } catch {
      setState("error");
    }
  }, [client, workspaceRoot]);

  useEffect(() => {
    void load();
  }, [load, refreshVersion]);

  // Keep the ref in sync for selection stability across refreshes.
  useEffect(() => {
    selectedFileRef.current = selectedFile;
  }, [selectedFile]);

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

  const selectedDiff = selectedFile ? diffs[selectedFile] : null;

  const renderBody = () => {
    if (state === "loading") {
      return (
        <div className="flex flex-1 items-center justify-center gap-2 text-xs text-muted-foreground" role="status">
          <Loader2 className="animate-spin" /> Loading changes…
        </div>
      );
    }
    if (state === "error") {
      return (
        <div className="flex flex-1 flex-col items-center justify-center gap-3 p-6 text-center text-xs text-muted-foreground" role="status">
          <p>Couldn’t read the repository diff.</p>
          <Button variant="outline" size="sm" onClick={refresh}>Try again</Button>
        </div>
      );
    }
    if (!isRepo) {
      return (
        <div className="flex flex-1 flex-col items-center justify-center gap-2 p-6 text-center text-xs text-muted-foreground" role="status">
          <GitBranch className="opacity-50" />
          <p>Not a git repository.</p>
        </div>
      );
    }
    if (files.length === 0) {
      return (
        <div className="flex flex-1 items-center justify-center p-6 text-center text-xs text-muted-foreground" role="status">
          <p>No changes — the working tree is clean.</p>
        </div>
      );
    }
    return (
      <div ref={containerRef} className="flex min-h-0 flex-1 flex-col">
        <div
          className="min-h-0 overflow-y-auto border-b border-border"
          style={listHeight !== null ? { height: listHeight } : { flex: "0 0 45%" }}
        >
          {files.map((entry) => {
            const statusClass =
              entry.status === "added" ? "text-green-11" :
                entry.status === "deleted" ? "text-red-11" : "text-amber-11";
            const StatusIcon =
              entry.status === "added" ? FilePlus2 :
                entry.status === "deleted" ? FileMinus2 : FilePenLine;
            const active = entry.file === selectedFile;
            return (
              <button
                key={entry.file}
                type="button"
                onClick={() => setSelectedFile(entry.file)}
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
          {selectedDiff && selectedDiff.patch ? (
            <DiffView diff={selectedDiff.patch} className="max-h-full overflow-auto rounded-md font-mono text-[11px] leading-relaxed" />
          ) : (
            <p className="text-xs text-muted-foreground">No diff available for this file.</p>
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
          {branch ?? "Git diff"}
        </span>
        {isRepo && files.length > 0 ? (
          <span className="shrink-0 text-[10px] tabular-nums text-muted-foreground">
            <span className="text-green-11">+{counts.added}</span>{" "}
            <span className="text-red-11">−{counts.deleted}</span>{" "}
            <span className="text-amber-11">~{counts.modified}</span>
          </span>
        ) : null}
        <Tooltip>
          <TooltipTrigger render={(
            <Button variant="ghost" size="icon-sm" onClick={refresh} aria-label="Refresh git diff" disabled={state === "loading"}>
              <RefreshCw className={state === "loading" ? "animate-spin" : undefined} />
            </Button>
          )} />
          <TooltipContent>Refresh</TooltipContent>
        </Tooltip>
      </div>
      {renderBody()}
    </div>
  );
}
