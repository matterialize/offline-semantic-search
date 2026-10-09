// Development cutoff for LEAF similarity with bounded structural evidence.
// This is a ranking signal, not calibrated confidence.
export const MIN_MATCH_PERCENT = 30;

export function isRelevantResult(result: { score: number; evidenceScore?: number; excludedReason?: string }): boolean {
  return !result.excludedReason && isRelevant(relevanceScore(result));
}

export function matchPercent(score: number): number {
  return 100 * Math.max(0, Math.min(1, score));
}

export function isRelevant(score: number): boolean {
  return Number.isFinite(score) && matchPercent(score) >= MIN_MATCH_PERCENT;
}

export function relevanceScore(result: { score: number; evidenceScore?: number }): number {
  return result.evidenceScore ?? result.score;
}
