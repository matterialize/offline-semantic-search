import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { ettinScore, readSafetensors } from '../../src/search/ettin-head';
import { pairWindows } from '../../src/search/reranker';
import fixture from '../fixtures/ettin-head.json';

describe('Ettin classifier and complete context coverage', () => {
  it('matches an independent Python math.erf reference for the publisher weights', () => {
    const read = (module: string) => {
      const bytes = readFileSync(`public/models/cross-encoder/ettin-reranker-17m-v1/${module}/model.safetensors`);
      return readSafetensors(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
    };
    const dense = read('2_Dense'), norm = read('3_LayerNorm'), output = read('4_Dense');
    expect(ettinScore(fixture.cls, { dense: dense['linear.weight'], normWeight: norm['norm.weight'], normBias: norm['norm.bias'],
      output: output['linear.weight'], bias: output['linear.bias'][0] })).toBeCloseTo(fixture.score, 5);
  });

  it('covers paragraph tails and query tails while respecting the mobile pair budget', () => {
    const query = Array.from({ length: 600 }, (_, i) => i + 100);
    const body = Array.from({ length: 3000 }, (_, i) => i + 1000);
    const pairs = pairWindows(query, body, [50, 51], 1024);
    expect(pairs.every((ids) => ids.length <= 1024 && ids[0] === 50281 && ids.at(-1) === 50282)).toBe(true);
    expect(query.every((id) => pairs.some((ids) => ids.includes(id)))).toBe(true);
    expect(body.every((id) => pairs.some((ids) => ids.includes(id)))).toBe(true);
  });

  it('allows native 7999-token pairs when explicitly selected', () => {
    const pairs = pairWindows([1, 2], Array(7990).fill(3), [], 7999);
    expect(pairs).toHaveLength(1);
    expect(pairs[0]).toHaveLength(7995);
    expect(() => pairWindows([], [], [], 8000)).toThrow();
  });
});
