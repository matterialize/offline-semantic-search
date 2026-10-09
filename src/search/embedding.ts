import { windows } from './budget';

export const MODEL = 'MongoDB/mdbr-leaf-ir';
export const EMBEDDING_DIMENSIONS = 768;
export const QUERY_PREFIX = 'Represent this sentence for searching relevant passages: ';
// LEAF accepts 512 wordpieces including CLS/SEP. Reserve the query prefix
// in every query window, and preserve coverage instead of truncating tails.
export const EMBEDDING_TOKENS = 510;
export const embeddingWindows = (tokens: number[], prefixTokens = 0) => tokens.length
  ? [...windows(tokens, EMBEDDING_TOKENS - prefixTokens, 32)]
  : [{ tokens: [], start: 0, end: 0 }];

export function normalize(vector: number[]): number[] {
  const norm = Math.hypot(...vector);
  if (!Number.isFinite(norm) || norm === 0) throw new Error('Invalid embedding');
  return vector.map((value) => value / norm);
}

export function cosine(a: number[], b: number[]): number {
  if (a.length !== b.length) throw new Error('Embedding dimensions differ');
  const score = a.reduce((sum, value, i) => sum + value * b[i], 0);
  return Math.max(-1, Math.min(1, score));
}
