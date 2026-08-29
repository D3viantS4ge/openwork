import { describe, expect, test } from "bun:test";

import type { ProviderListItem } from "../src/app/types";
import { estimateContextCost } from "../src/react-app/domains/session/surface/context-cost";

type Cost = ProviderListItem["models"][string]["cost"];

describe("estimateContextCost", () => {
  test("prices at max(cache write, input) when cache write exceeds input", () => {
    const cost: Cost = { input: 0.1, output: 0.6, cache: { read: 0.01, write: 0.125 } };
    // 684K tokens at $0.125/M
    expect(estimateContextCost(cost, 684_000)).toBeCloseTo(0.0855);
  });

  test("falls back to the uncached input rate when cache write is 0", () => {
    const cost: Cost = { input: 0.435, output: 0.87, cache: { read: 0.003625, write: 0 } };
    expect(estimateContextCost(cost, 1_000_000)).toBeCloseTo(0.435);
  });

  test("returns null for a free model", () => {
    const cost: Cost = { input: 0, output: 0, cache: { read: 0, write: 0 } };
    expect(estimateContextCost(cost, 1_000_000)).toBeNull();
  });

  test("returns null when cost is missing", () => {
    expect(estimateContextCost(undefined, 1_000_000)).toBeNull();
  });

  test("returns null for an empty context", () => {
    const cost: Cost = { input: 0.1, output: 0.6, cache: { read: 0.01, write: 0.125 } };
    expect(estimateContextCost(cost, 0)).toBeNull();
  });

  test("applies the over-200K rate for larger contexts (GPT Luna)", () => {
    const luna: Cost = {
      input: 0.1,
      output: 0.6,
      cache: { read: 0.01, write: 0.125 },
      tiers: [
        {
          input: 0.2,
          output: 0.9,
          cache: { read: 0.02, write: 0.25 },
          tier: { type: "context", size: 272_000 },
        },
      ],
      experimentalOver200K: { input: 0.2, output: 0.9, cache: { read: 0.02, write: 0.25 } },
    };
    // ≤200K → base rate $0.125/M
    expect(estimateContextCost(luna, 150_000)).toBeCloseTo(0.01875);
    // >200K → doubled rate $0.25/M
    expect(estimateContextCost(luna, 684_000)).toBeCloseTo(0.171);
    // >272K tier → still $0.25/M
    expect(estimateContextCost(luna, 300_000)).toBeCloseTo(0.075);
  });
});
