import type { SearchResult } from '../types';
import { RERANK_RULES } from './reranker-config';

// Raw classifier scores are relevance signals, not calibrated probabilities.
// Apply after scoring the full shortlist, including cached pairs.
export function filterRerankedResults(results: SearchResult[]): SearchResult[] {
  const scored = results.filter((result) => Number.isFinite(result.rerankScore));
  const best = Math.max(...scored.map((result) => result.rerankScore!));
  const cutoff = Math.max(RERANK_RULES.minScore, best - RERANK_RULES.maxScoreDrop);
  return scored.filter((result) => result.rerankScore! >= cutoff);
}
