import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  type PointerEvent as ReactPointerEvent,
  type TouchEvent as ReactTouchEvent,
  type UIEvent as ReactUIEvent,
  type WheelEvent as ReactWheelEvent,
} from "react";

import { isLiveStepAtBottom, pinnedAfterUserScroll, pinnedAfterWheel } from "./live-step-scroll";

const GESTURE_WINDOW_MS = 600;

export type StickyBottomScrollOptions = {
  startAtBottom?: boolean;
};

export type StickyBottomScrollProps<T extends HTMLElement> = {
  "data-scrollable": "";
  onScroll: (event: ReactUIEvent<T>) => void;
  onWheel: (event: ReactWheelEvent<T>) => void;
  onTouchStart: (event: ReactTouchEvent<T>) => void;
  onTouchMove: (event: ReactTouchEvent<T>) => void;
  onPointerDown: (event: ReactPointerEvent<T>) => void;
};

export function useStickyBottomScroll<T extends HTMLElement>(
  options: StickyBottomScrollOptions = {},
) {
  const startAtBottom = options.startAtBottom ?? false;
  const ref = useRef<T>(null);
  const pinnedRef = useRef<boolean | null>(null);
  const gestureAtRef = useRef(0);
  const draggingRef = useRef(false);

  const markGesture = useCallback(() => {
    gestureAtRef.current = Date.now();
  }, []);

  const handleScroll = useCallback((event: ReactUIEvent<T>) => {
    const node = event.currentTarget;
    if (node.clientHeight <= 0) return;
    if (!draggingRef.current && Date.now() - gestureAtRef.current >= GESTURE_WINDOW_MS) return;
    gestureAtRef.current = Date.now();
    pinnedRef.current = pinnedAfterUserScroll(isLiveStepAtBottom(node));
  }, []);

  const handleWheel = useCallback((event: ReactWheelEvent<T>) => {
    markGesture();
    pinnedRef.current = pinnedAfterWheel({
      deltaY: event.deltaY,
      pinned: pinnedRef.current ?? true,
      atBottom: isLiveStepAtBottom(event.currentTarget),
    });
  }, [markGesture]);

  const handleTouchStart = useCallback((_event: ReactTouchEvent<T>) => {
    markGesture();
  }, [markGesture]);

  const handleTouchMove = useCallback((_event: ReactTouchEvent<T>) => {
    markGesture();
  }, [markGesture]);

  const handlePointerDown = useCallback((_event: ReactPointerEvent<T>) => {
    draggingRef.current = true;
    markGesture();
  }, [markGesture]);

  useEffect(() => {
    const endDrag = () => {
      draggingRef.current = false;
    };
    window.addEventListener("pointerup", endDrag);
    window.addEventListener("pointercancel", endDrag);
    return () => {
      window.removeEventListener("pointerup", endDrag);
      window.removeEventListener("pointercancel", endDrag);
    };
  }, []);

  useLayoutEffect(() => {
    const node = ref.current;
    if (!node) {
      pinnedRef.current = null;
      return;
    }
    if (node.clientHeight <= 0) {
      pinnedRef.current = null;
      return;
    }
    if (pinnedRef.current === null) {
      pinnedRef.current = startAtBottom || isLiveStepAtBottom(node);
    }
    if (pinnedRef.current) {
      node.style.overflowAnchor = "none";
      node.scrollTop = node.scrollHeight;
    } else {
      node.style.overflowAnchor = "auto";
    }
  });

  const scrollProps: StickyBottomScrollProps<T> = {
    "data-scrollable": "",
    onScroll: handleScroll,
    onWheel: handleWheel,
    onTouchStart: handleTouchStart,
    onTouchMove: handleTouchMove,
    onPointerDown: handlePointerDown,
  };

  return { ref, scrollProps };
}
