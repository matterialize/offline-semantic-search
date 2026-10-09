import { AutoTokenizer, env, Tensor, type PreTrainedTokenizer } from '@huggingface/transformers';
import { AcceleratedModel } from './runtime';
import { windows } from './budget';
import { ettinScore, readSafetensors, type EttinHead } from './ettin-head';
import type { SearchResult } from '../types';

import { RERANK_MODEL, RERANK_RULES } from './reranker-config';
export { RERANK_MODEL, RERANK_RULES } from './reranker-config';
let modelPromise: Promise<{ tokenizer: PreTrainedTokenizer; model: AcceleratedModel; head: EttinHead }> | undefined;
const cache = new Map<string, number>();

async function load(useGpu: boolean) {
  if (!modelPromise) modelPromise = (async () => {
    const weight = async (module: string) => {
      const response = await fetch(`${env.localModelPath}${RERANK_MODEL}/${module}/model.safetensors`);
      if (!response.ok) throw new Error('Missing local classifier weights');
      return readSafetensors(await response.arrayBuffer());
    };
    const [tokenizer, model, dense, norm, output] = await Promise.all([
      AutoTokenizer.from_pretrained(RERANK_MODEL, { local_files_only: true }),
      // The publisher's qint8 ARM graph exports token states, not classification scores.
      AcceleratedModel.load(RERANK_MODEL, useGpu, 'fp32', 'fp32', 'model_qint8_arm64'),
      weight('2_Dense'), weight('3_LayerNorm'), weight('4_Dense'),
    ]);
    return { tokenizer, model, head: { dense: dense['linear.weight'], normWeight: norm['norm.weight'],
      normBias: norm['norm.bias'], output: output['linear.weight'], bias: output['linear.bias'][0] } };
  })().catch((error) => { modelPromise = undefined; throw error; });
  return modelPromise;
}

export function pairWindows(query: number[], body: number[], section: number[], maxTokens: number): number[][] {
  if (!Number.isInteger(maxTokens) || maxTokens < 256 || maxTokens > RERANK_RULES.nativeMaxPairTokens) throw new Error('Invalid reranker context length');
  const prefix = section.slice(0, 64);
  // Cover long queries and paragraphs completely, with overlapping body windows.
  const queries = query.length ? [...windows(query, Math.min(256, maxTokens - prefix.length - 67), 32)] : [{ tokens: [] }];
  return queries.flatMap((part) => {
    const capacity = maxTokens - part.tokens.length - prefix.length - 3;
    const targets = body.length ? [...windows(body, capacity, Math.min(64, capacity - 1))] : [{ tokens: [] }];
    return targets.map((target) => [50281, ...part.tokens, 50282, ...prefix, ...target.tokens, 50282]);
  });
}

export async function rerank(query: string, candidates: Array<{ result: SearchResult; text: string; section: string }>, options: {
  useGpu: boolean; cancelled(): boolean; yield(): Promise<void>; progress(completed: number, total: number): void; maxPairTokens: number;
}) {
  if (!candidates.length) return { results: [], pairs: 0, cacheHits: 0, loadMs: 0, longestPair: 0, batches: 0, runtime: undefined };
  options.progress(0, candidates.length);
  const started = performance.now();
  const { tokenizer, model, head } = await load(options.useGpu);
  const loadMs = performance.now() - started;
  if (options.cancelled()) return;
  const queryTokens = tokenizer.encode(query, { add_special_tokens: false });
  let pairs = 0;
  let cacheHits = 0;
  let longestPair = 0;
  let batches = 0;
  const results = candidates.map(({ result }) => ({ ...result }));
  const keys: string[] = [];
  const pending = new Map<number, { left: number; score: number }>();
  const work: Array<{ ids: number[]; candidate: number }> = [];
  for (let index = 0; index < candidates.length; index++) {
    if (options.cancelled()) return;
    const candidate = candidates[index];
    const key = JSON.stringify([query, candidate.text, candidate.section, options.maxPairTokens]);
    keys.push(key);
    const cached = cache.get(key);
    if (cached !== undefined) {
      cacheHits++; cache.delete(key); cache.set(key, cached);
      results[index].rerankScore = cached;
    } else {
      const jobs = pairWindows(queryTokens, tokenizer.encode(candidate.text, { add_special_tokens: false }),
        tokenizer.encode(candidate.section ? candidate.section + '\n\n' : '', { add_special_tokens: false }), options.maxPairTokens);
      pending.set(index, { left: jobs.length, score: -Infinity });
      jobs.forEach((ids) => work.push({ ids, candidate: index }));
    }
    await options.yield();
  }
  work.sort((a, b) => a.ids.length - b.ids.length);
  let completed = cacheHits;
  options.progress(completed, candidates.length);
  for (let offset = 0; offset < work.length;) {
    if (options.cancelled()) return;
    // GPU batches are bounded by both pair count and padded tokens. Long pairs
    // remain single inputs; the CPU fallback keeps its original memory budget.
    let end = offset + 1;
    if (model.info.device === 'webgpu') {
      while (end < work.length && end - offset < 4 && (end - offset + 1) * work[end].ids.length <= 2048) end++;
    }
    const batch = work.slice(offset, end);
    const length = Math.max(...batch.map((job) => job.ids.length));
    const ids = new BigInt64Array(batch.length * length).fill(50283n);
    const mask = new BigInt64Array(ids.length);
    batch.forEach((job, row) => job.ids.forEach((id, column) => {
      ids[row * length + column] = BigInt(id); mask[row * length + column] = 1n;
    }));
    const inputs = { input_ids: new Tensor('int64', ids, [batch.length, length]),
      attention_mask: new Tensor('int64', mask, [batch.length, length]) };
    let output: Record<string, Tensor> | undefined;
    try {
      output = await model.run(inputs);
      const states = output.last_hidden_state;
      if (!states || states.dims[0] !== batch.length || states.dims[1] !== length || states.dims[2] !== 256) throw new Error('Invalid Ettin encoder output');
      for (let row = 0; row < batch.length; row++) {
        const job = batch[row];
        longestPair = Math.max(longestPair, job.ids.length);
        const target = pending.get(job.candidate)!;
        const start = row * length * 256;
        target.score = Math.max(target.score, ettinScore(states.data.slice(start, start + 256) as Float32Array, head));
        pairs++;
        if (--target.left === 0) {
          if (!Number.isFinite(target.score)) throw new Error('Invalid Ettin relevance score');
          results[job.candidate].rerankScore = target.score;
          if (options.cancelled()) return;
          cache.set(keys[job.candidate], target.score);
          if (cache.size > 512) cache.delete(cache.keys().next().value!);
          completed++;
        }
      }
      batches++;
    } finally {
      Object.values(inputs).forEach((tensor) => tensor.dispose());
      if (output) Object.values(output).forEach((tensor) => { if (tensor instanceof Tensor) tensor.dispose(); });
    }
    offset = end;
    options.progress(completed, candidates.length);
    await options.yield();
  }
  results.sort((a, b) => b.rerankScore! - a.rerankScore!);
  return { results, pairs, cacheHits, loadMs, longestPair, batches, runtime: model.info };
}
