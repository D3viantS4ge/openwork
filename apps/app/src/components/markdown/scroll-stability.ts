import { useEffect, useLayoutEffect, useRef, type RefObject } from "react";

type ScrollOffset = { left: number; top: number };

function scrollableDescendants(root: Element): HTMLElement[] {
  const result: HTMLElement[] = [];
  const visit = (node: Element) => {
    for (const child of Array.from(node.children)) {
      const element = child as HTMLElement;
      if (
        element.scrollWidth > element.clientWidth ||
        element.scrollHeight > element.clientHeight
      ) {
        result.push(element);
      }
      visit(element);
    }
  };
  visit(root);
  return result;
}

/**
 * Keep the scroll offsets of scrollable descendants stable across
 * dangerouslySetInnerHTML replacements. Streaming markdown commits a fresh
 * innerHTML string on every output chunk, which destroys and recreates all
 * descendant nodes — any scrolled code block (`<pre class="overflow-x-auto">`,
 * shiki containers) would snap back to offset 0 on the next chunk. Live
 * scroll events record offsets by positional index; after each commit the
 * offsets are restored onto the matching new nodes (append-only growth keeps
 * the indices stable).
 */
export function useScrollStableHtml(
  rootRef: RefObject<HTMLElement | null>,
  html: string,
): void {
  const offsetsRef = useRef<ScrollOffset[]>([]);

  // Record live offsets whenever the user scrolls anything inside the root
  // (scroll does not bubble, so capture is required to observe descendants).
  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;

    const record = (event: Event) => {
      const target = event.target;
      if (!(target instanceof HTMLElement)) return;
      const index = scrollableDescendants(root).findIndex((element) => element === target);
      if (index === -1) return;
      offsetsRef.current[index] = { left: target.scrollLeft, top: target.scrollTop };
    };

    root.addEventListener("scroll", record, true);
    return () => root.removeEventListener("scroll", record, true);
  }, [rootRef]);

  // The innerHTML commit has already replaced the tree when this runs;
  // restore the recorded offsets onto the new nodes by position. Writes are
  // skipped when the value already matches so restored positions don't
  // re-record their own scroll events.
  useLayoutEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const stored = offsetsRef.current;
    if (stored.length === 0) return;
    let index = 0;
    for (const element of scrollableDescendants(root)) {
      const offset = stored[index];
      if (offset !== undefined) {
        if (offset.left !== 0 && element.scrollLeft !== offset.left) {
          element.scrollLeft = offset.left;
        }
        if (offset.top !== 0 && element.scrollTop !== offset.top) {
          element.scrollTop = offset.top;
        }
      }
      index += 1;
    }
    offsetsRef.current = [];
  }, [html, rootRef]);
}
