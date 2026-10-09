/** Read the publisher's small, unquantized classification modules. */
export function readSafetensors(buffer: ArrayBuffer): Record<string, Float32Array> {
  const headerLength = Number(new DataView(buffer).getBigUint64(0, true));
  const header = JSON.parse(new TextDecoder().decode(new Uint8Array(buffer, 8, headerLength)));
  const tensors: Record<string, Float32Array> = {};
  for (const [name, spec] of Object.entries(header)) {
    if (name === '__metadata__') continue;
    const item = spec as { dtype: string; data_offsets: number[] };
    if (item.dtype !== 'F32') throw new Error('Unsupported classifier weight type');
    const [start, end] = item.data_offsets;
    tensors[name] = new Float32Array(buffer.slice(8 + headerLength + start, 8 + headerLength + end));
  }
  return tensors;
}

export interface EttinHead { dense: Float32Array; normWeight: Float32Array; normBias: Float32Array; output: Float32Array; bias: number }

// erf approximation (maximum absolute error ~1.5e-7), used for exact-form GELU.
function erf(x: number): number {
  const sign = x < 0 ? -1 : 1;
  const t = 1 / (1 + .3275911 * Math.abs(x));
  return sign * (1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - .284496736) * t + .254829592) * t * Math.exp(-x * x));
}

/** CLS pooling -> Dense/GELU -> LayerNorm -> scalar Dense, matching modules.json. */
export function ettinScore(cls: ArrayLike<number>, head: EttinHead): number {
  const size = 256;
  if (cls.length !== size || head.dense.length !== size * size || head.normWeight.length !== size
    || head.normBias.length !== size || head.output.length !== size) throw new Error('Invalid Ettin classifier shape');
  const hidden = new Float64Array(size);
  for (let row = 0; row < size; row++) {
    let x = 0;
    for (let column = 0; column < size; column++) x += head.dense[row * size + column] * cls[column];
    hidden[row] = .5 * x * (1 + erf(x / Math.SQRT2));
  }
  const mean = hidden.reduce((sum, x) => sum + x, 0) / size;
  const variance = hidden.reduce((sum, x) => sum + (x - mean) ** 2, 0) / size;
  const inverse = 1 / Math.sqrt(variance + 1e-5);
  return hidden.reduce((score, x, i) => score + ((x - mean) * inverse * head.normWeight[i] + head.normBias[i]) * head.output[i], head.bias);
}
