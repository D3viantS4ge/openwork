"use client"

import { useCallback, useEffect, useRef } from "react"
import { useWorkbenchDisclosure } from "@/react-app/domains/session/chat/workbench-ui-state"
import { ChevronDown } from "lucide-react"

import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible"
import { MessageContent } from "@/components/ui/message"
import { cn } from "@/lib/utils"

type ReasoningBlockProps = {
  text: string
  isStreaming: boolean
  className?: string
  disclosureKey?: string
}

// Positions within this many px of the bottom count as "at bottom" for the
// stream pin; a real scroll-up must release it.
const THOUGHT_STICKY_GAP_PX = 24
// Scroll events within this window of a wheel/touch/pointer gesture are
// treated as user input. Events from our own programmatic pins are never
// preceded by a gesture, so they are ignored entirely.
const THOUGHT_GESTURE_WINDOW_MS = 600

/**
 * Thinking is collapsed by default — the full reasoning renders as markdown
 * only when opened; a chevron collapses it. The content scrolls inside its
 * own bounded region so the collapse label always sits above the scroll bar,
 * and while streaming the region tails to the newest reasoning (unless the
 * reader scrolled up). The open/closed state is remembered per disclosure
 * key via the workbench UI state.
 */
export function ReasoningBlock({ text, isStreaming, className, disclosureKey }: ReasoningBlockProps) {
  const [open, setOpen] = useWorkbenchDisclosure(disclosureKey)
  const contentRef = useRef<HTMLDivElement>(null)
  const atBottomRef = useRef(true)
  const gestureAtRef = useRef(0)
  const draggingRef = useRef(false)

  const markGesture = useCallback(() => {
    gestureAtRef.current = Date.now()
  }, [])

  const handleContentScroll = () => {
    const node = contentRef.current
    if (!node) return
    const userDriven =
      draggingRef.current ||
      Date.now() - gestureAtRef.current < THOUGHT_GESTURE_WINDOW_MS
    if (!userDriven) return
    atBottomRef.current =
      node.scrollHeight - node.scrollTop - node.clientHeight <= THOUGHT_STICKY_GAP_PX
  }

  // Tail the reasoning while it streams, but only while the reader is at
  // the bottom of the region — scrolling up to read earlier thinking must
  // not be fought by the stream.
  useEffect(() => {
    const node = contentRef.current
    if (node && isStreaming && atBottomRef.current) {
      node.scrollTop = node.scrollHeight
    }
  })

  // Clear the drag state when the pointer is released anywhere (the thumb
  // may be released outside the container).
  useEffect(() => {
    const endDrag = () => {
      draggingRef.current = false
    }
    window.addEventListener("pointerup", endDrag)
    window.addEventListener("pointercancel", endDrag)
    return () => {
      window.removeEventListener("pointerup", endDrag)
      window.removeEventListener("pointercancel", endDrag)
    }
  }, [])

  return (
    <Collapsible open={open} onOpenChange={setOpen} className={cn("w-full", className)} data-reasoning-block="">
      <CollapsibleTrigger className="group flex cursor-pointer items-center gap-1 text-sm text-muted-foreground transition-colors hover:text-foreground">
        <span className={cn(isStreaming && "animate-pulse")}>
          {isStreaming ? "Thinking…" : "Thought"}
        </span>
        <ChevronDown
          aria-hidden="true"
          className="size-3.5 text-muted-foreground/70 transition-transform duration-150 group-data-panel-open:rotate-180"
        />
      </CollapsibleTrigger>
      <CollapsibleContent className="h-(--collapsible-panel-height) overflow-hidden transition-[height] duration-150 ease-out data-starting-style:h-0 data-ending-style:h-0 [&[hidden]:not([hidden='until-found'])]:hidden">
        <div
          ref={contentRef}
          onWheel={markGesture}
          onTouchStart={markGesture}
          onTouchMove={markGesture}
          onPointerDown={() => {
            draggingRef.current = true
            markGesture()
          }}
          onScroll={handleContentScroll}
          className="max-h-[520px] overflow-y-auto"
        >
          <MessageContent
            markdown
            isStreaming={isStreaming}
            className="text-muted-foreground prose mt-1 w-full min-w-0 rounded-lg bg-transparent p-0 text-sm"
          >
            {text}
          </MessageContent>
        </div>
      </CollapsibleContent>
    </Collapsible>
  )
}
