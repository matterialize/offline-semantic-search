import { AutoTokenizer, Tensor, type PreTrainedTokenizer } from '@huggingface/transformers';
import { AcceleratedModel, GpuFallbackError, configureRuntime, type BackendPreference } from './runtime';
import { aggregateQueryScores } from './budget';
import { MODEL, EMBEDDING_DIMENSIONS, QUERY_PREFIX, embeddingWindows, normalize, cosine } from './embedding';
import { rankResults } from './ranking';
import { excludeStandaloneNumbers, finalizeRetrieved } from './hybrid';
import { rerank, RERANK_MODEL, RERANK_RULES } from './reranker';
import { filterRerankedResults } from './reranker-filter';
import { isQuestion } from './query';
import { sectionInput, sectionKey, type SectionInput } from './section';
import { tokenOffsets } from './token-offsets';
import type { SearchResult, WorkerRequest, WorkerResponse } from '../types';

interface EmbeddedWindow { vector: number[]; start: number; end: number }
let passageCache = new Map<string, EmbeddedWindow[]>();
let generation = 0;
let pending: Extract<WorkerRequest, { type: 'search' }> | undefined;
let running = false;
let batchSize = 4;
let modelPromise: Promise<{ tokenizer: PreTrainedTokenizer; model: AcceleratedModel; gpuAvailable: boolean }> | undefined;
const tick = () => {
  const scheduler = (globalThis as typeof globalThis & { scheduler?: { yield(): Promise<void> } }).scheduler;
  return scheduler?.yield() ?? new Promise<void>((resolve) => setTimeout(resolve, 0));
};
const send = (message: WorkerResponse) => self.postMessage(message);

async function load(assetBase: string, preference: BackendPreference, requestedBatchSize?: number) {
  if (!modelPromise) {
    modelPromise = (async () => {
      const supported = await configureRuntime(assetBase, preference);
      const [tokenizer, model] = await Promise.all([
        AutoTokenizer.from_pretrained(MODEL, { local_files_only: true }),
        AcceleratedModel.load(MODEL, supported.fp16, 'q4f16', 'q8'),
      ]);
      batchSize = model.info.device === 'webgpu' ? requestedBatchSize ?? 8 : 4;
      return { tokenizer, model, gpuAvailable: supported.gpu };
    })().catch((error) => { modelPromise = undefined; throw error; });
  }
  return modelPromise;
}

interface Job { inputIds: number[]; start: number; end: number }

async function predict(model: AcceleratedModel, jobs: Job[]): Promise<number[][]> {
  const length = Math.max(...jobs.map((job) => job.inputIds.length));
  const ids = new BigInt64Array(jobs.length * length);
  const mask = new BigInt64Array(ids.length);
  jobs.forEach((job, row) => job.inputIds.forEach((id, column) => {
    ids[row * length + column] = BigInt(id);
    mask[row * length + column] = 1n;
  }));
  const inputs = {
    input_ids: new Tensor('int64', ids, [jobs.length, length]),
    attention_mask: new Tensor('int64', mask, [jobs.length, length]),
    token_type_ids: new Tensor('int64', new BigInt64Array(ids.length), [jobs.length, length]),
  };
  let output: Record<string, Tensor> | undefined;
  let converted: Tensor | undefined;
  try {
    output = await model.run(inputs);
    // The LEAF ONNX graph includes pooling, its learned projection and
    // normalization. Read its final sentence vector rather than pooling again.
    const embedding = output!.sentence_embedding;
    if (!embedding || embedding.dims.length !== 2 || embedding.dims[0] !== jobs.length
      || embedding.dims[1] !== EMBEDDING_DIMENSIONS) throw new Error('Invalid model output');
    converted = embedding.to('float32');
    return jobs.map((_, row) => normalize(Array.from(
      converted!.data.slice(row * EMBEDDING_DIMENSIONS, (row + 1) * EMBEDDING_DIMENSIONS), Number,
    )));
  } finally {
    if (converted && converted !== output?.sentence_embedding) converted.dispose();
    for (const tensor of Object.values(inputs)) tensor.dispose();
    if (output) for (const tensor of Object.values(output)) if (tensor instanceof Tensor) tensor.dispose();
  }
}

async function search(request: Extract<WorkerRequest, { type: 'search' }>) {
  const loadStart = performance.now();
  const { tokenizer, model, gpuAvailable } = await load(request.assetBase, request.backend ?? 'auto', request.embeddingBatchSize);
  const loadMs = performance.now() - loadStart;
  if (generation !== request.generation) return;
  const started = performance.now();
  const query = request.query;
  const passages = request.snapshot.passages;
  // Retain only text from the current snapshot; edited text gets new vectors.
  const blocks = request.snapshot.blocks ?? [];
  const passageLookup = new Map(passages.map((passage) => [passage.id, passage]));
  const inputs = new Map<string, SectionInput>();
  const passageKeys = new Map<string, string>();
  const blockKeys = new Map<string, string>();
  for (const passage of passages) {
    const input = sectionInput(passage, passageLookup);
    const key = sectionKey(input);
    inputs.set(key, input);
    passageKeys.set(passage.id, key);
  }
  for (const block of blocks) {
    if (block.passageIds.length < 2) continue;
    const representative = passageLookup.get(block.passageIds[0])!;
    const input = sectionInput({ ...representative, text: block.text, role: 'body' }, passageLookup);
    const key = sectionKey(input);
    inputs.set(key, input);
    blockKeys.set(block.id, key);
  }
  passageCache = new Map([...passageCache].filter(([key]) => inputs.has(key)));
  let embeddings = 0;
  let cacheHits = 0;
  let pairs = 0;

  let inferenceBatches = 0;
  let embeddingInferenceMs = 0;
  let yieldDeadline = performance.now() + 20;
  async function yieldIfNeeded() {
    if (performance.now() >= yieldDeadline) {
      await tick();
      yieldDeadline = performance.now() + 20;
    }
  }
  const queryPrefixTokens = tokenizer.encode(QUERY_PREFIX, { add_special_tokens: false });
  function jobsFor(text: string, isQuery = false, section = ''): Job[] {
    // Repeat a bounded section prefix in every window; offsets still address
    // body text only, so headings never become the highlighted evidence.
    const prefix = isQuery ? queryPrefixTokens : section
      ? tokenizer.encode(section + '\n\n', { add_special_tokens: false }).slice(0, 64) : [];
    const pieces = tokenizer.tokenize(text);
    const tokens = tokenizer.convert_tokens_to_ids(pieces);
    const offsets = tokenOffsets(text, pieces);
    return embeddingWindows(tokens, prefix.length).map((part) => ({
      inputIds: [101, ...prefix, ...part.tokens, 102],
      start: offsets[part.start]?.start ?? 0,
      end: offsets[part.end - 1]?.end ?? text.length,
    }));
  }
  async function runBatch(batch: Job[]): Promise<number[][]> {
    try {
      const inferenceStart = performance.now();
      const vectors = await predict(model, batch);
      embeddingInferenceMs += performance.now() - inferenceStart;
      embeddings += batch.length;
      inferenceBatches++;
      return vectors;
    } catch (error) {
      if (batch.length > 1 && /memory|alloc|out of bounds/i.test(String(error))) {
        batchSize = 1;
        const vectors: number[][] = [];
        for (const job of batch) {
          if (generation !== request.generation) return [];
          vectors.push(...await runBatch([job]));
          await tick();
        }
        return vectors;
      }
      throw error;
    }
  }
  const queryJobs = jobsFor(query, true);
  const queries: EmbeddedWindow[] = [];
  for (let i = 0; i < queryJobs.length;) {
    if (generation !== request.generation) return;
    const batch = queryJobs.slice(i, i + batchSize);
    const vectors = await runBatch(batch);
    batch.forEach((job, index) => queries.push({ ...job, vector: vectors[index] }));
    i += batch.length;
    await yieldIfNeeded();
  }
  // Questions use the same section-aware vectors and the general question filter.
  const questionQueries = isQuestion(query) ? queries : [];
  if (generation !== request.generation) return;

  interface PassageJob extends Job { text: string; window: number }
  const work: PassageJob[] = [];
  const prepared = new Map<string, EmbeddedWindow[]>();
  const remaining = new Map<string, number>();
  for (const [text, input] of inputs) {
    if (generation !== request.generation) return;
    if (!passageCache.has(text)) {
      const jobs = jobsFor(input.text, false, input.section);
      prepared.set(text, Array(jobs.length));
      remaining.set(text, jobs.length);
      jobs.forEach((job, window) => work.push({ ...job, text, window }));
    }
    await yieldIfNeeded();
  }
  // Batch across independent passages, grouping similar lengths to avoid
  // padding a tiny heading to the length of a long paragraph.
  work.sort((a, b) => a.inputIds.length - b.inputIds.length);
  let lastProgress = -Infinity;
  const progress = (completed: number) => {
    if (performance.now() - lastProgress < 100 && completed !== work.length) return;
    lastProgress = performance.now();
    send({ type: 'progress', generation: request.generation, completed, total: work.length });
  };
  progress(0);
  for (let i = 0; i < work.length;) {
    if (generation !== request.generation) return;
    const batch = work.slice(i, i + batchSize);
    const vectors = await runBatch(batch);
    if (generation !== request.generation) return;
    batch.forEach((job, index) => {
      const target = prepared.get(job.text)!;
      target[job.window] = { vector: vectors[index], start: job.start, end: job.end };
      // Cache only complete texts, so cancelled searches never leave holes.
      const left = remaining.get(job.text)! - 1;
      remaining.set(job.text, left);
      if (left === 0) passageCache.set(job.text, target);
    });
    i += batch.length;
    progress(i);
    await yieldIfNeeded();
  }

  function compare(targets: EmbeddedWindow[], wholeParagraph = false, queryVectors = queries) {
    let best = { score: -Infinity, start: 0, end: targets.at(-1)?.end ?? 0 };
    const scores = queryVectors.map((query) => {
      let maximum = -Infinity;
      let total = 0;
      for (const target of targets) {
        const score = cosine(query.vector, target.vector);
        pairs++;
        maximum = Math.max(maximum, score);
        total += score;
        if (score > best.score) best = { score, start: target.start, end: target.end };
      }
      return wholeParagraph ? total / targets.length : maximum;
    });
    return { score: aggregateQueryScores(scores), start: best.start, end: best.end };
  }
  const paragraphScores = new Map<string, number>();
  for (const block of blocks) {
    if (generation !== request.generation) return;
    if (block.passageIds.length > 1) paragraphScores.set(block.id, compare(passageCache.get(blockKeys.get(block.id)!)!, true).score);
    await yieldIfNeeded();
  }
  const questionSentences = new Map<string, number>();
  const questionParagraphs = questionQueries.length ? new Map(paragraphScores) : new Map<string, number>();
  const results: SearchResult[] = [];
  for (const passage of passages) {
    if (generation !== request.generation) return;
    if (!prepared.has(passageKeys.get(passage.id)!)) cacheHits++;
    const result = { passageId: passage.id, ...compare(passageCache.get(passageKeys.get(passage.id)!)!) };
    if (questionQueries.length) questionSentences.set(passage.id, result.score);
    results.push({ ...result, questionScore: questionQueries.length ? result.score : undefined });
    await yieldIfNeeded();
  }
  if (generation !== request.generation) return;
  const passageById = new Map(passages.map((passage) => [passage.id, passage]));
  const ranked = rankResults(query, passages, results, paragraphScores).map((result) =>
    excludeStandaloneNumbers(query, passageById.get(result.passageId)!.text, result));
  const useReranker = request.reranker !== false;
  const retrieved = finalizeRetrieved(query, request.snapshot, ranked, paragraphScores, !useReranker && questionQueries.length ? { sentences: questionSentences, paragraphs: questionParagraphs } : undefined);
  const rerankStart = performance.now();
  const maxPairTokens = request.maxPairTokens ?? RERANK_RULES.maxPairTokens;
  const reranked = useReranker ? await rerank(query, retrieved.slice(0, RERANK_RULES.candidates).map((result) => ({
    result, text: result.paragraph?.text ?? passageById.get(result.passageId)!.text,
    section: sectionInput(passageById.get(result.passageId)!, passageById).section,
  })), { useGpu: gpuAvailable, cancelled: () => generation !== request.generation, yield: tick, maxPairTokens,
    progress: (completed, total) => send({ type: 'progress', generation: request.generation, completed, total, phase: 'rerank' }),
  }) : undefined;
  if (generation !== request.generation) return;
  const displayed = reranked ? filterRerankedResults(reranked.results) : retrieved;
  send({ type: 'results', generation: request.generation, results: displayed, sentenceScores: ranked, candidateScores: retrieved,
    metrics: { embeddingInferenceMs, embeddingRuntime: { ...model.info, fallback: request.fallbackReason }, embeddingBatchSize: batchSize, rerankerRuntime: reranked?.runtime ? { ...reranked.runtime, fallback: request.fallbackReason } : undefined, rerankBatches: reranked?.batches, loadMs, searchMs: performance.now() - started, pairs, embeddings, cacheHits, inferenceBatches,
      passages: passages.length, paragraphs: blocks.filter((block) => block.passageIds.length > 1).length,
      sentences: passages.reduce((count, passage) => count + (passage.sentenceCount ?? (passage.kind === 'heading' ? 0 : 1)), 0),
      headings: passages.filter((passage) => passage.kind === 'heading').length,
      effectiveQuery: query, candidates: retrieved.length, reranker: useReranker ? RERANK_MODEL : undefined,
      rerankPairs: reranked?.pairs, rerankCacheHits: reranked?.cacheHits, rerankLoadMs: reranked?.loadMs,
      rerankMs: useReranker ? performance.now() - rerankStart : undefined, maxPairTokens: useReranker ? maxPairTokens : undefined,
      rerankLongestPair: reranked?.longestPair } });
}

async function drain() {
  if (running) return;
  running = true;
  try {
    while (pending) {
      const request = pending;
      pending = undefined;
      try { await search(request); }
      catch (error) {
        if (error instanceof GpuFallbackError) {
          // Even a cancelled GPU job can poison the shared runtime. The panel
          // restarts its worker and re-extracts the current query generation.
          send({ type: 'fallback', reason: error.message });
          pending = undefined;
          return;
        }
        console.error('Local search failed', error);
        if (generation === request.generation) send({ type: 'error', generation, message: 'Search couldn’t finish on this device. Try again.' });
      }
      await tick();
    }
  } finally { running = false; }
}

self.onmessage = (event: MessageEvent<WorkerRequest>) => {
  generation = event.data.generation;
  pending = event.data.type === 'search' ? event.data : undefined;
  void drain();
};
