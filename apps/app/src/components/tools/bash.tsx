"use client"

import { useMemo } from "react"
import { SquareTerminalIcon } from "lucide-react"
import {
  CollapsibleTool,
  CollapsibleToolContent,
  CollapsibleToolStep,
  CollapsibleToolTrigger,
} from "@/components/tools/collapsible-tool"
import { parseShellMetadata } from "@/app/lib/shell-metadata"
import type { BashToolPart } from "@/lib/build-in-tools"

interface BashToolProps {
  part: BashToolPart
}

export function BashTool({ part }: BashToolProps) {
  const exit = typeof part.metadata?.exit === "number" ? part.metadata.exit : null
  const truncated = part.metadata?.truncated === true
  const parsed = useMemo(() => parseShellMetadata(part.output ?? ""), [part.output])

  return (
    <CollapsibleTool>
      <CollapsibleToolStep defaultOpen className="flex flex-col gap-2">
        <CollapsibleToolTrigger leftIcon={<SquareTerminalIcon className="size-4" />}>
          <span className="flex gap-2">
            <span className="shrink-0">
              {part.input.description}
            </span>
            <span className="min-w-0 flex-1 whitespace-pre-wrap wrap-break-word opacity-80">
              {part.input.command}
            </span>
          </span>
        </CollapsibleToolTrigger>
        <CollapsibleToolContent className="bg-muted rounded-lg p-2">
          <div className="flex flex-col gap-2 text-xs">
            <pre className="whitespace-pre-wrap wrap-break-word">$ {part.input.command}</pre>
            <span className="flex items-center gap-2">
              {exit !== null ? (
                <span
                  className={
                    exit === 0
                      ? "text-green-11 inline-flex items-center gap-1"
                      : "text-destructive inline-flex items-center gap-1"
                  }
                >
                  <span
                    className={
                      exit === 0
                        ? "size-1.5 rounded-full bg-green-9"
                        : "size-1.5 rounded-full bg-red-9"
                    }
                  />
                  exit {exit}
                </span>
              ) : null}
              {truncated ? (
                <span className="text-muted-foreground">(output truncated)</span>
              ) : null}
            </span>
            {parsed.notes.length > 0 ? (
              <div className="rounded-md border border-red-7/30 bg-red-2/40 px-2 py-1.5 text-[11px] leading-relaxed text-red-11">
                {parsed.notes.map((note, index) => (
                  <div key={index}>{note}</div>
                ))}
              </div>
            ) : null}
            {parsed.body ? (
              <pre className="max-h-[32rem] overflow-auto whitespace-pre-wrap wrap-break-word opacity-80">
                {parsed.body}
              </pre>
            ) : null}
          </div>
        </CollapsibleToolContent>
      </CollapsibleToolStep>
    </CollapsibleTool>
  )
}
