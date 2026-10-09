import { expect, it } from 'vitest';
import { embeddingWindows, normalize, cosine } from '../../src/search/embedding';

it('covers every token of long text within the model limit', () => {
  const tokens = Array.from({ length: 700 }, (_, i) => i);
  const parts = embeddingWindows(tokens);
  expect(parts.every((part) => part.tokens.length + 2 <= 512)).toBe(true);
  expect(new Set(parts.flatMap((part) => part.tokens)).size).toBe(700);
  expect(parts.at(-1)?.end).toBe(700);
});
it('compares normalized vectors without turning unrelated vectors into matches', () => {
  const a = normalize([3, 4]);
  expect(cosine(a, a)).toBeCloseTo(1);
  expect(cosine(a, normalize([-4, 3]))).toBeCloseTo(0);
  expect(cosine(a, normalize([-3, -4]))).toBeCloseTo(-1);
  expect(() => normalize([0, 0])).toThrow('Invalid embedding');
});
