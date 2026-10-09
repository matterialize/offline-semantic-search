import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { SearchResult } from '../../src/types';

const mocks = vi.hoisted(() => ({ run: vi.fn(), gpu: true }));
vi.mock('@huggingface/transformers', () => ({
  env: { localModelPath: '/models/' },
  AutoTokenizer: { from_pretrained: async () => ({ encode: (text: string) => text ? text.split(' ').map(Number) : [] }) },
  Tensor: class {
    constructor(public type: string, public data: BigInt64Array, public dims: number[]) {}
    dispose() {}
  },
}));
vi.mock('../../src/search/runtime', () => ({
  AcceleratedModel: { load: async () => ({ info: { device: mocks.gpu ? 'webgpu' : 'wasm' }, run: mocks.run }) },
}));
vi.mock('../../src/search/ettin-head', () => ({
  readSafetensors: () => ({ 'linear.weight': new Float32Array(1), 'linear.bias': new Float32Array(1),
    'norm.weight': new Float32Array(1), 'norm.bias': new Float32Array(1) }),
  ettinScore: (cls: Float32Array) => cls[0],
}));
beforeEach(() => {
  vi.resetModules(); mocks.run.mockReset(); mocks.gpu = true;
  vi.stubGlobal('fetch', async () => ({ ok: true, arrayBuffer: async () => new ArrayBuffer(0) }));
  mocks.run.mockImplementation(async (inputs) => {
    const [batch, length] = inputs.input_ids.dims;
    const states = new Float32Array(batch * length * 256);
    for (let row = 0; row < batch; row++) {
      const ids = inputs.input_ids.data.slice(row * length, (row + 1) * length);
      const mask = inputs.attention_mask.data.slice(row * length, (row + 1) * length);
      const last = mask.lastIndexOf(1n);
      expect(ids[last]).toBe(50282n);
      expect([...ids.slice(last + 1)].every((id) => id === 50283n)).toBe(true);
      expect([...mask.slice(last + 1)].every((value) => value === 0n)).toBe(true);
      // Encode a known per-row CLS score to detect incorrect output strides.
      states[row * length * 256] = Number(ids[3]);
    }
    return { last_hidden_state: { data: states, dims: [batch, length, 256] } };
  });
});
afterEach(() => vi.unstubAllGlobals());

const candidates = ['1 2 3', '4', '5 6', '7 8 9 10', '11 12'].map((text, i) => ({
  text, section: '', result: { passageId: String(i), score: .5, start: 0, end: text.length } as SearchResult,
}));
const options = () => ({ useGpu: mocks.gpu, cancelled: () => false, yield: async () => {}, progress: vi.fn(), maxPairTokens: 1024 });

it('pads and masks mixed-length GPU pairs, maps row outputs correctly and caches completed scores', async () => {
  const { rerank } = await import('../../src/search/reranker');
  const result = await rerank('99', candidates, options());
  expect(result!.results.map((row) => row.rerankScore)).toEqual([11, 7, 5, 4, 1]);
  expect(result).toMatchObject({ pairs: 5, batches: 2, cacheHits: 0 });
  const cached = await rerank('99', candidates, options());
  expect(cached).toMatchObject({ pairs: 0, batches: 0, cacheHits: 5 });
  expect(mocks.run).toHaveBeenCalledTimes(2);
});

it('keeps CPU pairs unpadded and produces the same ordering', async () => {
  mocks.gpu = false;
  const { rerank } = await import('../../src/search/reranker');
  const result = await rerank('99', candidates, options());
  expect(result!.results.map((row) => row.rerankScore)).toEqual([11, 7, 5, 4, 1]);
  expect(result).toMatchObject({ pairs: 5, batches: 5 });
  expect(mocks.run.mock.calls.every(([inputs]) => inputs.input_ids.dims[0] === 1)).toBe(true);
});

it('does not infer or publish results for a cancelled job', async () => {
  const { rerank } = await import('../../src/search/reranker');
  expect(await rerank('99', candidates, { ...options(), cancelled: () => true })).toBeUndefined();
  expect(mocks.run).not.toHaveBeenCalled();
});
