import { describe, expect, test } from "bun:test";

import { computeOverlayThumb } from "../src/react-app/domains/session/artifacts/overlay-scrollbar";

describe("computeOverlayThumb", () => {
  test("returns null when content fits", () => {
    expect(computeOverlayThumb({
      scrollTop: 0,
      scrollHeight: 100,
      clientHeight: 100,
      trackHeight: 100,
    })).toBeNull();
  });

  test("scales the thumb and clamps its position", () => {
    expect(computeOverlayThumb({
      scrollTop: 0,
      scrollHeight: 400,
      clientHeight: 200,
      trackHeight: 100,
    })).toEqual({ top: 0, height: 50 });

    expect(computeOverlayThumb({
      scrollTop: 200,
      scrollHeight: 400,
      clientHeight: 200,
      trackHeight: 100,
    })).toEqual({ top: 50, height: 50 });
  });

  test("enforces a minimum thumb height", () => {
    expect(computeOverlayThumb({
      scrollTop: 0,
      scrollHeight: 10_000,
      clientHeight: 100,
      trackHeight: 100,
    })).toEqual({ top: 0, height: 24 });
  });

  test("clamps out-of-range scroll positions", () => {
    expect(computeOverlayThumb({
      scrollTop: -50,
      scrollHeight: 400,
      clientHeight: 200,
      trackHeight: 100,
    })?.top).toBe(0);

    expect(computeOverlayThumb({
      scrollTop: 9_999,
      scrollHeight: 400,
      clientHeight: 200,
      trackHeight: 100,
    })?.top).toBe(50);
  });

  test("caps the thumb at the track height", () => {
    expect(computeOverlayThumb({
      scrollTop: 0,
      scrollHeight: 10_000,
      clientHeight: 100,
      trackHeight: 10,
    })).toEqual({ top: 0, height: 10 });
  });
});
