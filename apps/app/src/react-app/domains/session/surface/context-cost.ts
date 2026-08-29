import type { ProviderListItem } from "@/app/types";

type ProviderModelCost = ProviderListItem["models"][string]["cost"];

const TOKENS_PER_MILLION = 1_000_000;

/**
 * Estimate the dollar cost of sending `contextTokens` of context through the
 * model, priced at the cache-write rate (falling back to the uncached input
 * rate when the model has no cache-write pricing), accounting for
 * context-size tiers and the over-200K rate. Returns `null` when the model
 * has no cost data, the context is empty, or the model is free.
 */
export function estimateContextCost(
  cost: ProviderModelCost | undefined,
  contextTokens: number,
): number | null {
  if (!cost || contextTokens <= 0) return null;

  let rate = Math.max(cost.cache.write, cost.input);
  const candidates = [
    ...(cost.experimentalOver200K
      ? [{ threshold: 200_000, source: cost.experimentalOver200K }]
      : []),
    ...(cost.tiers ?? []).map((tier) => ({ threshold: tier.tier.size, source: tier })),
  ].sort((left, right) => left.threshold - right.threshold);
  for (const { threshold, source } of candidates) {
    if (contextTokens > threshold) rate = Math.max(source.cache.write, source.input);
  }

  if (rate <= 0) return null;
  return (contextTokens / TOKENS_PER_MILLION) * rate;
}
