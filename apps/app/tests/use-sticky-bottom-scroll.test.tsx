/** @jsxImportSource react */
import { describe, expect, test } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { act } from "react";
import { createRoot } from "react-dom/client";

import { useStickyBottomScroll } from "../src/components/chat/use-sticky-bottom-scroll";

function Harness({ content, startAtBottom = false }: { content: string; startAtBottom?: boolean }) {
  const scroll = useStickyBottomScroll<HTMLPreElement>({ startAtBottom });
  return <pre ref={scroll.ref} {...scroll.scrollProps}>{content}</pre>;
}

async function withRoot(fn: (container: HTMLDivElement, root: ReturnType<typeof createRoot>) => Promise<void>) {
  const registeredDom = typeof globalThis.window === "undefined" || typeof globalThis.document === "undefined";
  if (registeredDom) GlobalRegistrator.register();
  Object.defineProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT", {
    configurable: true,
    value: true,
  });
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  try {
    await fn(container, root);
  } finally {
    await act(async () => root.unmount());
    container.remove();
    if (registeredDom) await GlobalRegistrator.unregister();
  }
}

function installGeometry(pre: HTMLPreElement, initial: { scrollHeight: number; clientHeight: number; scrollTop: number }) {
  let scrollTop = initial.scrollTop;
  let scrollHeight = initial.scrollHeight;
  const clientHeight = initial.clientHeight;
  Object.defineProperties(pre, {
    scrollHeight: { configurable: true, get: () => scrollHeight },
    clientHeight: { configurable: true, get: () => clientHeight },
    scrollTop: {
      configurable: true,
      get: () => scrollTop,
      set: (value: number) => {
        scrollTop = Math.max(0, Math.min(value, scrollHeight - clientHeight));
      },
    },
  });
  return {
    get scrollTop() {
      return scrollTop;
    },
    set scrollTop(value: number) {
      scrollTop = value;
    },
    set scrollHeight(value: number) {
      scrollHeight = value;
    },
  };
}

describe("useStickyBottomScroll", () => {
  test("starts at the bottom for live content and follows growth", async () => {
    await withRoot(async (container, root) => {
      await act(async () => root.render(<Harness content="one" startAtBottom />));
      const pre = container.querySelector("pre");
      if (!pre) throw new Error("Expected the scroll box");
      const geometry = installGeometry(pre, { scrollHeight: 800, clientHeight: 200, scrollTop: 0 });

      await act(async () => root.render(<Harness content={"one\ntwo"} startAtBottom />));
      expect(geometry.scrollTop).toBe(600);

      geometry.scrollHeight = 1000;
      await act(async () => root.render(<Harness content={"one\ntwo\nthree"} startAtBottom />));
      expect(geometry.scrollTop).toBe(800);
    });
  });

  test("does not start at the bottom when live-tail is disabled", async () => {
    await withRoot(async (container, root) => {
      await act(async () => root.render(<Harness content="one" />));
      const pre = container.querySelector("pre");
      if (!pre) throw new Error("Expected the scroll box");
      const geometry = installGeometry(pre, { scrollHeight: 800, clientHeight: 200, scrollTop: 0 });

      await act(async () => root.render(<Harness content={"one\ntwo"} />));
      expect(geometry.scrollTop).toBe(0);
    });
  });

  test("unpins on wheel-up and scroll-up, then resumes at the bottom", async () => {
    await withRoot(async (container, root) => {
      await act(async () => root.render(<Harness content="one" startAtBottom />));
      const pre = container.querySelector("pre");
      if (!pre) throw new Error("Expected the scroll box");
      const geometry = installGeometry(pre, { scrollHeight: 800, clientHeight: 200, scrollTop: 0 });
      await act(async () => root.render(<Harness content={"one\ntwo"} startAtBottom />));
      expect(geometry.scrollTop).toBe(600);

      await act(async () => {
        pre.dispatchEvent(new WheelEvent("wheel", { bubbles: true, deltaY: -10 }));
        geometry.scrollTop = 100;
        pre.dispatchEvent(new Event("scroll"));
      });

      geometry.scrollHeight = 1000;
      await act(async () => root.render(<Harness content={"one\ntwo\nthree"} startAtBottom />));
      expect(geometry.scrollTop).toBe(100);

      await act(async () => {
        pre.dispatchEvent(new WheelEvent("wheel", { bubbles: true, deltaY: 10 }));
        geometry.scrollTop = 800;
        pre.dispatchEvent(new Event("scroll"));
      });

      geometry.scrollHeight = 1200;
      await act(async () => root.render(<Harness content={"one\ntwo\nthree\nfour"} startAtBottom />));
      expect(geometry.scrollTop).toBe(1000);
    });
  });

  test("ignores non-gesture scroll events so programmatic scrolls cannot unpin", async () => {
    await withRoot(async (container, root) => {
      await act(async () => root.render(<Harness content="one" startAtBottom />));
      const pre = container.querySelector("pre");
      if (!pre) throw new Error("Expected the scroll box");
      const geometry = installGeometry(pre, { scrollHeight: 800, clientHeight: 200, scrollTop: 0 });
      await act(async () => root.render(<Harness content={"one\ntwo"} startAtBottom />));
      expect(geometry.scrollTop).toBe(600);

      await act(async () => {
        geometry.scrollTop = 100;
        pre.dispatchEvent(new Event("scroll"));
      });

      geometry.scrollHeight = 1000;
      await act(async () => root.render(<Harness content={"one\ntwo\nthree"} startAtBottom />));
      expect(geometry.scrollTop).toBe(800);
    });
  });

  test("marks the scroller as nested", async () => {
    await withRoot(async (container, root) => {
      await act(async () => root.render(<Harness content="one" />));
      expect(container.querySelector("pre")?.getAttribute("data-scrollable")).toBe("");
    });
  });
});
