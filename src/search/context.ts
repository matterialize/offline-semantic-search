import type { Passage, SearchResult } from '../types';
import { isRelevantResult, matchPercent, MIN_MATCH_PERCENT, relevanceScore } from './relevance';

// Cosine similarity is not probability. Neighbor expansion uses the same
// absolute cutoff and a maximum ten-point similarity drop.
export const CONTEXT_MAX_PERCENT_DROP = 10;

/** Extend in DOM order; never jump across weak text, headings, or DOM scopes. */
export function surroundingMatches(
  passages: Passage[],
  scores: ReadonlyMap<string, SearchResult>,
  selected: SearchResult,
): SearchResult[] {
  if (!isRelevantResult(selected)) return [];
  const anchor = passages.findIndex((passage) => passage.id === selected.passageId);
  if (anchor < 0 || passages[anchor].kind === 'heading') return [];
  const group = passages[anchor].contextGroup;
  const threshold = Math.max(MIN_MATCH_PERCENT, matchPercent(relevanceScore(selected)) - CONTEXT_MAX_PERCENT_DROP);
  const before: SearchResult[] = [];
  const after: SearchResult[] = [];
  for (const direction of [-1, 1]) {
    for (let i = anchor + direction; i >= 0 && i < passages.length; i += direction) {
      const passage = passages[i];
      const result = scores.get(passage.id);
      if (passage.kind === 'heading' || passage.contextGroup !== group || !result || !isRelevantResult(result) || matchPercent(relevanceScore(result)) < threshold) break;
      (direction < 0 ? before : after).push(result);
    }
  }
  return [...before.reverse(), ...after];
}
