export const RERANK_MODEL = 'cross-encoder/ettin-reranker-17m-v1';
export const RERANK_RULES = { candidates: 40, maxPairTokens: 1024, nativeMaxPairTokens: 7999,
  minScore: 4, maxScoreDrop: 2 } as const;
