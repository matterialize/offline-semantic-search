export interface Passage {
  id: string;
  order: number;
  text: string;
  kind: 'sentence' | 'heading';
  blockId?: string;
  sentenceCount?: number;
  headingLevel?: number;
  sectionHeadingIds?: string[];
  role?: 'body' | 'navigation' | 'control' | 'fragment' | 'reference';
  contextGroup: string;
  before: string;
  after: string;
}

export interface Snapshot {
  id: number;
  subject?: string;
  passages: Passage[];
  coverageNote: string;
  blocks?: Array<{ id: string; text: string; passageIds: string[] }>;
}

export interface SearchResult {
  passageId: string;
  score: number;
  evidenceScore?: number;
  excludedReason?: string;
  questionScore?: number;
  rerankScore?: number;
  paragraph?: { blockId: string; text: string; passageIds: string[]; focus: { passageId: string; score: number; start: number; end: number } };
  ranking?: { paragraphSimilarity: number; paragraphBoost: number; tier: number; value: number; ownSimilarity: number; sectionSimilarity: number; sectionBoost: number; exactMatch: boolean; reason: string };
  start: number;
  end: number;
}

export interface SearchMetrics {
  embeddingInferenceMs?: number;
  embeddingRuntime?: import('./search/runtime').RuntimeInfo;
  rerankerRuntime?: import('./search/runtime').RuntimeInfo;
  embeddingBatchSize?: number;
  rerankBatches?: number;
  loadMs: number;
  searchMs: number;
  pairs: number;
  embeddings: number;
  inferenceBatches: number;
  cacheHits: number;
  passages: number;
  paragraphs: number;
  sentences: number;
  headings: number;
  candidates?: number;
  effectiveQuery?: string;
  reranker?: string;
  rerankPairs?: number;
  rerankCacheHits?: number;
  rerankLoadMs?: number;
  rerankMs?: number;
  maxPairTokens?: number;
  rerankLongestPair?: number;
}

export type WorkerRequest =
  | { type: 'search'; generation: number; query: string; snapshot: Snapshot; assetBase: string; reranker?: boolean; maxPairTokens?: number; backend?: import('./search/runtime').BackendPreference; embeddingBatchSize?: number; fallbackReason?: string }
  | { type: 'cancel'; generation: number };

export type WorkerResponse =
  | { type: 'fallback'; reason: string }
  | { type: 'progress'; generation: number; completed: number; total: number; phase?: 'rerank' }
  | { type: 'results'; generation: number; results: SearchResult[]; sentenceScores: SearchResult[]; candidateScores: SearchResult[]; metrics: SearchMetrics }
  | { type: 'error'; generation: number; message: string };

export type BridgeMessage =
  | { type: 'ping' }
  | { type: 'extract'; generation: number }
  | { type: 'snapshot'; generation: number; snapshot: Snapshot }
  | { type: 'select'; snapshotId: number; result: SearchResult; context: SearchResult[] }
  | { type: 'clear' }
  | { type: 'close' }
  | { type: 'focus' }
  | { type: 'changed' }
  | { type: 'resize'; height: number }
  | { type: 'error'; message: string };
