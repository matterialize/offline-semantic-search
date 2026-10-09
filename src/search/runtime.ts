import { AutoModel, env, type PreTrainedModel, type Tensor } from '@huggingface/transformers';

export type BackendPreference = 'auto' | 'wasm' | 'webgpu';
export interface RuntimeInfo { device: 'webgpu' | 'wasm'; dtype: 'q4f16' | 'fp16' | 'fp32' | 'q8'; fallback?: string; modelFile?: string }
interface GPUAdapterLike { features: { has(name: string): boolean }; info?: { isFallbackAdapter?: boolean } }
interface GPULike { requestAdapter(options: { powerPreference: string }): Promise<GPUAdapterLike | null> }
let capability: Promise<{ gpu: boolean; fp16: boolean }> | undefined;

export async function configureRuntime(assetBase: string, preference: BackendPreference) {
  env.allowRemoteModels = false;
  env.allowLocalModels = true;
  env.useBrowserCache = false;
  env.useWasmCache = false;
  env.useFS = false;
  env.useFSCache = false;
  env.localModelPath = new URL('models/', assetBase).pathname;
  capability ??= (async () => {
    if (preference === 'wasm') return { gpu: false, fp16: false };
    try {
      const gpu = (navigator as Navigator & { gpu?: GPULike }).gpu;
      const adapter = await gpu?.requestAdapter({ powerPreference: 'high-performance' });
      // Software adapters do not provide the acceleration we are selecting for.
      const available = !!adapter && !adapter.info?.isFallbackAdapter;
      return { gpu: available, fp16: available && adapter!.features.has('shader-f16') };
    } catch { return { gpu: false, fp16: false }; }
  })();
  const supported = await capability;
  const wasm = env.backends.onnx.wasm!;
  wasm.numThreads = 1;
  wasm.proxy = false;
  // v4's WebGPU EP requires asyncify. CPU-only workers use plain WASM, including
  // older Safari and fresh workers created after GPU errors.
  const suffix = supported.gpu ? '.asyncify' : '';
  wasm.wasmPaths = {
    mjs: new URL(`runtime/ort-wasm-simd-threaded${suffix}.mjs`, assetBase).href,
    wasm: new URL(`runtime/ort-wasm-simd-threaded${suffix}.wasm`, assetBase).href,
  };
  return supported;
}

// Transformers.js 4.3.0 leaves its shared initialization/inference promise
// chains rejected after an ORT failure. Recovery needs a fresh CPU worker.
export class GpuFallbackError extends Error {}

export class AcceleratedModel {
  private constructor(public model: PreTrainedModel, public info: RuntimeInfo) {}

  static async load(id: string, useGpu: boolean, gpuDtype: 'q4f16' | 'fp16' | 'fp32', cpuDtype: 'q8' | 'fp32', cpuFile?: string) {
    const info: RuntimeInfo = useGpu ? { device: 'webgpu', dtype: gpuDtype }
      : { device: 'wasm', dtype: cpuFile ? 'q8' : cpuDtype, modelFile: cpuFile };
    try {
      const model = await AutoModel.from_pretrained(id, {
        local_files_only: true, device: info.device, dtype: useGpu ? gpuDtype : cpuDtype,
        ...(!useGpu && cpuFile ? { model_file_name: cpuFile } : {}),
      });
      return new AcceleratedModel(model, info);
    } catch (error) {
      if (!useGpu) throw error;
      console.warn('GPU model initialization failed; restarting on CPU', id, error);
      throw new GpuFallbackError('GPU initialization failed');
    }
  }

  async run(inputs: Record<string, Tensor>): Promise<Record<string, Tensor>> {
    try { return await this.model(inputs); }
    catch (error) {
      if (this.info.device !== 'webgpu') throw error;
      console.warn('GPU inference failed; restarting on CPU', error);
      throw new GpuFallbackError('GPU inference failed');
    }
  }
}
