/** @jsxImportSource react */
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";

export type OverlayThumb = {
  top: number;
  height: number;
};

export function computeOverlayThumb({
  scrollTop,
  scrollHeight,
  clientHeight,
  trackHeight,
  minThumbHeight = 24,
}: {
  scrollTop: number;
  scrollHeight: number;
  clientHeight: number;
  trackHeight: number;
  minThumbHeight?: number;
}): OverlayThumb | null {
  if (trackHeight <= 0 || clientHeight <= 0 || scrollHeight <= clientHeight) {
    return null;
  }

  const height = Math.min(trackHeight, Math.max(minThumbHeight, (clientHeight / scrollHeight) * trackHeight));
  const maxTop = Math.max(0, trackHeight - height);
  const maxScroll = scrollHeight - clientHeight;
  const top = maxScroll > 0
    ? Math.min(maxTop, Math.max(0, (scrollTop / maxScroll) * maxTop))
    : 0;

  return { top, height };
}

type OverlayScrollbarProps = {
  scrollElement: HTMLElement | null;
};

const SCROLLING_VISIBLE_MS = 700;

export function OverlayScrollbar({ scrollElement }: OverlayScrollbarProps) {
  const trackRef = useRef<HTMLDivElement | null>(null);
  const [thumb, setThumb] = useState<OverlayThumb | null>(null);
  const [scrolling, setScrolling] = useState(false);
  const scrollTimerRef = useRef<number | null>(null);
  const dragRef = useRef<{
    startY: number;
    startScrollTop: number;
    trackHeight: number;
    thumbHeight: number;
  } | null>(null);

  const update = useCallback(() => {
    const scroll = scrollElement;
    const track = trackRef.current;
    if (!scroll || !track) {
      setThumb((current) => (current === null ? current : null));
      return;
    }

    const next = computeOverlayThumb({
      scrollTop: scroll.scrollTop,
      scrollHeight: scroll.scrollHeight,
      clientHeight: scroll.clientHeight,
      trackHeight: track.clientHeight,
    });

    setThumb((current) => {
      if (next === null) return current === null ? current : null;
      if (current && current.top === next.top && current.height === next.height) return current;
      return next;
    });
  }, [scrollElement]);

  useLayoutEffect(() => {
    update();
  }, [update]);

  useEffect(() => {
    if (!scrollElement) return;

    const showScrolling = () => {
      setScrolling(true);
      if (scrollTimerRef.current !== null) window.clearTimeout(scrollTimerRef.current);
      scrollTimerRef.current = window.setTimeout(() => {
        scrollTimerRef.current = null;
        setScrolling(false);
      }, SCROLLING_VISIBLE_MS);
    };

    const onScroll = () => {
      update();
      showScrolling();
    };

    scrollElement.addEventListener("scroll", onScroll, { passive: true });

    const observer = new ResizeObserver(update);
    observer.observe(scrollElement);
    const track = trackRef.current;
    if (track) observer.observe(track);
    const list = scrollElement.querySelector('[data-file-tree-virtualized-list="true"]');
    if (list instanceof HTMLElement) observer.observe(list);

    return () => {
      scrollElement.removeEventListener("scroll", onScroll);
      observer.disconnect();
      if (scrollTimerRef.current !== null) {
        window.clearTimeout(scrollTimerRef.current);
        scrollTimerRef.current = null;
      }
    };
  }, [scrollElement, update]);

  const handlePointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    const scroll = scrollElement;
    const track = trackRef.current;
    const current = thumb;
    if (!scroll || !track || !current || event.button !== 0) return;

    const maxScroll = scroll.scrollHeight - scroll.clientHeight;
    const maxTop = track.clientHeight - current.height;
    if (maxScroll <= 0 || maxTop <= 0) return;

    event.preventDefault();
    event.stopPropagation();
    dragRef.current = {
      startY: event.clientY,
      startScrollTop: scroll.scrollTop,
      trackHeight: track.clientHeight,
      thumbHeight: current.height,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const handlePointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    const scroll = scrollElement;
    if (!drag || !scroll) return;

    const maxScroll = scroll.scrollHeight - scroll.clientHeight;
    const maxTop = drag.trackHeight - drag.thumbHeight;
    if (maxScroll <= 0 || maxTop <= 0) return;

    scroll.scrollTop = drag.startScrollTop + ((event.clientY - drag.startY) / maxTop) * maxScroll;
  };

  const handlePointerEnd = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!dragRef.current) return;
    dragRef.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  };

  return (
    <div
      ref={trackRef}
      aria-hidden="true"
      data-scrolling={scrolling ? "true" : undefined}
      className="pointer-events-none absolute inset-y-0 right-0 z-10 w-1.5 opacity-0 transition-opacity duration-150 group-hover/tree:opacity-100 group-focus-within/tree:opacity-100 data-[scrolling=true]:opacity-100"
    >
      {thumb ? (
        <div
          className="pointer-events-none absolute right-0 w-1.5 cursor-grab rounded-full bg-border/80 transition-colors hover:bg-border active:cursor-grabbing group-hover/tree:pointer-events-auto group-focus-within/tree:pointer-events-auto"
          style={{ top: thumb.top, height: thumb.height }}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerEnd}
          onPointerCancel={handlePointerEnd}
        />
      ) : null}
    </div>
  );
}
