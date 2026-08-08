"use client"

import { createTwoFilesPatch, diffWords } from "diff"

export function isDiffText(value: unknown): value is string {
  return (
    typeof value === "string" &&
    (value.includes("@@") || value.includes("+++ ") || value.includes("--- "))
  )
}

/** Edit tools carry oldString/newString, so a diff can always be built even if the engine omits metadata. */
function getEditDiffFromInput(input: unknown): string | null {
  if (typeof input !== "object" || input === null) return null
  const record = input as Record<string, unknown>
  if (typeof record.oldString !== "string" || typeof record.newString !== "string") return null
  const filePath = typeof record.filePath === "string" && record.filePath ? record.filePath : "file"
  return createTwoFilesPatch(filePath, filePath, record.oldString, record.newString)
}

/** Tools like apply_patch carry the diff in their input (patchText); edit tools carry it in engine metadata. */
export function getToolInputDiff(input: unknown, metadata?: unknown): string | null {
  const record = typeof metadata === "object" && metadata !== null ? (metadata as Record<string, unknown>) : undefined;
  if (record) {
    if (isDiffText(record.diff)) {
      return record.diff
    }
    const filediff = record.filediff
    if (typeof filediff === "object" && filediff !== null && "patch" in filediff && isDiffText(filediff.patch)) {
      return filediff.patch
    }
  }
  if (isDiffText(input)) {
    return input
  }
  if (typeof input === "object" && input !== null && "patchText" in input) {
    const value = input.patchText
    if (isDiffText(value)) {
      return value
    }
  }
  return getEditDiffFromInput(input)
}

/** Word-level pair for one removed + one added diff line (green/red like opencode). */
function WordDiffPair({ before, after }: { before: string; after: string }) {
  const changes = diffWords(before, after)
  const removed: React.ReactNode[] = []
  const added: React.ReactNode[] = []
  let removedKey = 0
  let addedKey = 0
  for (const change of changes) {
    if (change.added) {
      added.push(
        <span key={`a${addedKey++}`} className="rounded-sm bg-green-2 font-medium text-green-11">
          {change.value}
        </span>,
      )
    } else if (change.removed) {
      removed.push(
        <span key={`r${removedKey++}`} className="rounded-sm bg-red-2 font-medium text-red-11">
          {change.value}
        </span>,
      )
    } else {
      removed.push(<span key={`rc${removedKey++}`}>{change.value}</span>)
      added.push(<span key={`ac${addedKey++}`}>{change.value}</span>)
    }
  }
  return (
    <>
      <div className="whitespace-pre-wrap wrap-break-word bg-red-1/40 px-1 text-red-11">-{removed}</div>
      <div className="whitespace-pre-wrap wrap-break-word bg-green-1/40 px-1 text-green-11">+{added}</div>
    </>
  )
}

export function DiffView({ diff, className }: { diff: string; className?: string }) {
  const rows: React.ReactNode[] = []
  let removed: string[] = []
  let added: string[] = []
  let key = 0

  const flushPair = () => {
    if (removed.length === 0 && added.length === 0) return
    const count = Math.max(removed.length, added.length)
    for (let index = 0; index < count; index++) {
      const before = removed[index]
      const after = added[index]
      if (before !== undefined && after !== undefined) {
        rows.push(<WordDiffPair key={key++} before={before} after={after} />)
      } else if (before !== undefined) {
        rows.push(
          <div key={key++} className="whitespace-pre-wrap wrap-break-word bg-red-1/40 px-1 text-red-11">
            -{before}
          </div>,
        )
      } else if (after !== undefined) {
        rows.push(
          <div key={key++} className="whitespace-pre-wrap wrap-break-word bg-green-1/40 px-1 text-green-11">
            +{after}
          </div>,
        )
      }
    }
    removed = []
    added = []
  }

  for (const raw of diff.split("\n")) {
    if (raw.startsWith("@@")) {
      flushPair()
      rows.push(
        <div key={key++} className="whitespace-pre-wrap wrap-break-word bg-blue-1/30 px-1 text-blue-11">
          {raw}
        </div>,
      )
      continue
    }
    if (raw.startsWith("--- ") || raw.startsWith("+++ ")) {
      flushPair()
      rows.push(
        <div key={key++} className="whitespace-pre-wrap wrap-break-word px-1 text-muted-foreground/80">
          {raw}
        </div>,
      )
      continue
    }
    if (raw.startsWith("-")) {
      removed.push(raw.slice(1))
      continue
    }
    if (raw.startsWith("+")) {
      added.push(raw.slice(1))
      continue
    }
    flushPair()
    rows.push(
      <div key={key++} className="whitespace-pre-wrap wrap-break-word px-1 text-muted-foreground/80">
        {raw || " "}
      </div>,
    )
  }
  flushPair()

  return <div className={className ?? "max-h-80 overflow-auto rounded-md font-mono leading-relaxed"}>{rows}</div>
}
