import { beforeEach, describe, expect, test } from "bun:test";

import {
  clearCachedCapability,
  loadCachedCapability,
  readCachedCapability,
} from "../src/react-app/domains/session/surface/composer/capability-cache";

const key = "workspace:1:commands";
const otherKey = `${key}:other`;

describe("composer capability cache", () => {
  beforeEach(() => {
    clearCachedCapability(key);
    clearCachedCapability(otherKey);
  });

  test("serves a resolved value without calling the loader again", async () => {
    let calls = 0;
    const loader = async () => {
      calls += 1;
      return ["release"];
    };

    await loadCachedCapability(key, loader);
    expect(readCachedCapability<string[]>(key)).toEqual(["release"]);
    await loadCachedCapability(key, loader);

    expect(calls).toBe(1);
  });

  test("shares one in-flight request between concurrent callers", async () => {
    let calls = 0;
    let resolvePending: (value: string[]) => void = () => {};
    const pending = new Promise<string[]>((resolve) => {
      resolvePending = resolve;
    });
    const loader = () => {
      calls += 1;
      return pending;
    };

    const first = loadCachedCapability(key, loader);
    const second = loadCachedCapability(key, loader);
    expect(calls).toBe(1);

    resolvePending(["release"]);
    await Promise.all([first, second]);

    expect(readCachedCapability<string[]>(key)).toEqual(["release"]);
  });

  test("revalidates when maxAgeMs is zero", async () => {
    let calls = 0;
    const loader = async () => {
      calls += 1;
      return [`call-${calls}`];
    };

    await loadCachedCapability(key, loader);
    await loadCachedCapability(key, loader, { maxAgeMs: 0 });

    expect(calls).toBe(2);
    expect(readCachedCapability<string[]>(key)).toEqual(["call-2"]);
  });

  test("isolates values by key", async () => {
    await loadCachedCapability(key, async () => ["commands"]);
    await loadCachedCapability(otherKey, async () => ["skills"]);

    expect(readCachedCapability<string[]>(key)).toEqual(["commands"]);
    expect(readCachedCapability<string[]>(otherKey)).toEqual(["skills"]);
  });

  test("keeps the last good value when a revalidation fails", async () => {
    await loadCachedCapability(key, async () => ["release"]);

    await expect(loadCachedCapability(key, async () => {
      throw new Error("engine unavailable");
    }, { maxAgeMs: 0 })).rejects.toThrow("engine unavailable");

    expect(readCachedCapability<string[]>(key)).toEqual(["release"]);
  });
});
