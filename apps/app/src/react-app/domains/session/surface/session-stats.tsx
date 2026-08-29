"use client"

import type { Session } from "@opencode-ai/sdk/v2/client"

import { cn } from "@/lib/utils"

export type SessionStatsProps = {
  session?: Pick<Session, "cost" | "tokens"> | null
  className?: string
}

function formatCost(cost: number): string {
  if (cost < 0.01) {
    return `$${cost.toFixed(4)}`
  }
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 4,
  }).format(cost)
}

function formatTokens(value: number): string {
  return new Intl.NumberFormat("en-US", {
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(value)
}

/**
 * Slim stats bar above the composer: total cost, input/output tokens and
 * the cache hit rate (cached input vs total input). Hover shows the full
 * breakdown (reasoning tokens, cache read/write). Hidden while the engine
 * has not reported any usage for the session.
 */
export function SessionStats({ session, className }: SessionStatsProps) {
  const cost = typeof session?.cost === "number" ? session.cost : null
  const tokens = session?.tokens
  const input = typeof tokens?.input === "number" ? tokens.input : null
  const output = typeof tokens?.output === "number" ? tokens.output : null
  const reasoning = typeof tokens?.reasoning === "number" ? tokens.reasoning : null
  const cacheRead = typeof tokens?.cache?.read === "number" ? tokens.cache.read : null
  const cacheWrite = typeof tokens?.cache?.write === "number" ? tokens.cache.write : null

  if (cost === null && input === null && output === null && cacheRead === null && cacheWrite === null) {
    return null
  }

  // Inclusive totals matching the LLM Usage contract: total input is fresh +
  // cached-read + cached-write, and total output is visible output + reasoning.
  const totalInput = (input ?? 0) + (cacheRead ?? 0) + (cacheWrite ?? 0)
  const totalOutput = (output ?? 0) + (reasoning ?? 0)
  const hasTokens = input !== null || output !== null || cacheRead !== null || cacheWrite !== null

  const cacheHitRate = cacheRead !== null && totalInput > 0 ? (cacheRead / totalInput) * 100 : null

  const detail = [
    cost !== null ? `cost ${formatCost(cost)}` : null,
    hasTokens ? `in ${formatTokens(totalInput)}` : null,
    hasTokens ? `out ${formatTokens(totalOutput)}` : null,
    reasoning !== null ? `reasoning ${formatTokens(reasoning)}` : null,
    cacheRead !== null ? `cache read ${formatTokens(cacheRead)}` : null,
    cacheWrite !== null ? `cache write ${formatTokens(cacheWrite)}` : null,
  ]
    .filter((value): value is string => value !== null)
    .join(" · ")

  return (
    <div
      className={cn(
        "flex min-w-0 items-center gap-3 overflow-hidden rounded-lg border border-border/60 bg-dls-surface/60 px-3 py-1 text-xs tabular-nums text-dls-secondary",
        className,
      )}
      data-testid="session-stats"
      title={detail}
    >
      {cost !== null ? <span>{formatCost(cost)}</span> : null}
      {hasTokens ? (
        <span>
          {formatTokens(totalInput)} in · {formatTokens(totalOutput)} out
        </span>
      ) : null}
      {reasoning !== null ? <span>reasoning {formatTokens(reasoning)}</span> : null}
      {cacheRead !== null ? <span>cache read {formatTokens(cacheRead)}</span> : null}
      {cacheWrite !== null ? <span>cache write {formatTokens(cacheWrite)}</span> : null}
      {cacheHitRate !== null ? <span>cache {cacheHitRate.toFixed(1)}%</span> : null}
    </div>
  )
}
