export const PREPROCESSING_VERSION = 'leaf-local-section-v12';

export interface TokenWindow { tokens: number[]; start: number; end: number }

export function* windows(tokens: number[], size: number, overlap = Math.floor(size / 4)): Generator<TokenWindow> {
  if (size < 1 || overlap < 0 || overlap >= size) throw new Error('Invalid token window');
  for (let start = 0; start < tokens.length;) {
    const end = Math.min(start + size, tokens.length);
    yield { tokens: tokens.slice(start, end), start, end };
    if (end === tokens.length) break;
    start = end - overlap;
  }
}

/** Cosine similarities are ranking signals; averaging query-window maxima is a heuristic. */
export function aggregateQueryScores(scores: number[]): number {
  return scores.reduce((sum, score) => sum + score, 0) / scores.length;
}
