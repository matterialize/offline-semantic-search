import { afterEach, beforeEach, expect, it, vi } from 'vitest';

const { fromPretrained, env } = vi.hoisted(() => ({
  fromPretrained: vi.fn(), env: { backends: { onnx: { wasm: {} } } },
}));
vi.mock('@huggingface/transformers', () => ({ AutoModel: { from_pretrained: fromPretrained }, env }));
beforeEach(() => { vi.resetModules(); fromPretrained.mockReset(); });
afterEach(() => vi.unstubAllGlobals());

it('chooses plain local WASM without a GPU and asyncify with an FP16 hardware GPU', async () => {
  vi.stubGlobal('navigator', {});
  let runtime = await import('../../src/search/runtime');
  expect(await runtime.configureRuntime('https://local.test/', 'auto')).toEqual({ gpu: false, fp16: false });
  expect(env).toMatchObject({ allowRemoteModels: false, localModelPath: '/models/', backends: { onnx: {
    wasm: { numThreads: 1, proxy: false, wasmPaths: { wasm: 'https://local.test/runtime/ort-wasm-simd-threaded.wasm' } },
  } } });
  vi.resetModules();
  vi.stubGlobal('navigator', { gpu: { requestAdapter: vi.fn().mockResolvedValue({ features: new Set(['shader-f16']) }) } });
  runtime = await import('../../src/search/runtime');
  expect(await runtime.configureRuntime('https://local.test/', 'auto')).toEqual({ gpu: true, fp16: true });
  expect(env.backends.onnx.wasm).toMatchObject({ wasmPaths: { wasm: 'https://local.test/runtime/ort-wasm-simd-threaded.asyncify.wasm' } });
});

it('rejects software adapters and honors explicit CPU mode', async () => {
  const requestAdapter = vi.fn().mockResolvedValue({ features: new Set(['shader-f16']), info: { isFallbackAdapter: true } });
  vi.stubGlobal('navigator', { gpu: { requestAdapter } });
  let runtime = await import('../../src/search/runtime');
  expect(await runtime.configureRuntime('https://local.test/', 'auto')).toEqual({ gpu: false, fp16: false });
  vi.resetModules(); requestAdapter.mockClear();
  runtime = await import('../../src/search/runtime');
  await runtime.configureRuntime('https://local.test/', 'wasm');
  expect(requestAdapter).not.toHaveBeenCalled();
});

it('requests a fresh worker after GPU initialization failure instead of reusing a rejected runtime', async () => {
  fromPretrained.mockRejectedValueOnce(new Error('Unsupported GPU operator'));
  const { AcceleratedModel, GpuFallbackError } = await import('../../src/search/runtime');
  await expect(AcceleratedModel.load('ettin', true, 'fp32', 'fp32', 'model_qint8_arm64')).rejects.toBeInstanceOf(GpuFallbackError);
  expect(fromPretrained).toHaveBeenCalledOnce();
});

it('signals a worker restart after GPU device loss', async () => {
  fromPretrained.mockResolvedValueOnce(vi.fn().mockRejectedValue(new Error('Device lost')));
  const { AcceleratedModel, GpuFallbackError } = await import('../../src/search/runtime');
  const model = await AcceleratedModel.load('leaf', true, 'q4f16', 'q8');
  await expect(model.run({})).rejects.toBeInstanceOf(GpuFallbackError);
  expect(fromPretrained).toHaveBeenCalledOnce();
});

it('loads the pinned quantized reranker in a CPU worker', async () => {
  fromPretrained.mockResolvedValue(vi.fn());
  const { AcceleratedModel } = await import('../../src/search/runtime');
  const model = await AcceleratedModel.load('ettin', false, 'fp32', 'fp32', 'model_qint8_arm64');
  expect(model.info).toMatchObject({ device: 'wasm', dtype: 'q8' });
  expect(fromPretrained).toHaveBeenCalledWith('ettin', expect.objectContaining({
    local_files_only: true, device: 'wasm', model_file_name: 'model_qint8_arm64',
  }));
});

it('does not retry CPU failures as GPU fallbacks', async () => {
  fromPretrained.mockResolvedValue(vi.fn().mockRejectedValue(new Error('CPU allocation failed')));
  const { AcceleratedModel } = await import('../../src/search/runtime');
  const model = await AcceleratedModel.load('leaf', false, 'q4f16', 'q8');
  await expect(model.run({})).rejects.toThrow('CPU allocation failed');
  expect(fromPretrained).toHaveBeenCalledOnce();
});
