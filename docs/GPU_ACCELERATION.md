# GPU acceleration

The default mode now selects LEAF q4f16 embeddings on hardware WebGPU adapters supporting shader-f16 and accelerates Ettin reranking with WebGPU. q4f16 uses 4-bit quantized matrix weights and FP16 floating-point computation; some weights remain floating point. This is the lowest weight precision published in the pinned LEAF export set, not 4-bit arithmetic throughout the network. CPU fallback retains q8 LEAF. Active Wikipedia tests use only a pinned Apple Inc. snapshot, with GPU and CPU coverage.

## Modes

In the **panel frame's** developer console:

```js
semanticFindDev.setBackend('auto');      // Default: q4f16 GPU LEAF + FP32 GPU Ettin
semanticFindDev.setBackend('wasm');      // Original quantized CPU models
semanticFindDev.setBackend('webgpu', 8); // q4f16 GPU LEAF + FP32 GPU Ettin
semanticFindDev.metrics();              // Actual devices, precision and timings
```

GPU support is detected inside the dedicated inference worker. Software adapters are excluded. q4f16 embeddings require `shader-f16`; without it, LEAF stays on CPU, while GPU reranking can still run. GPU pair batches contain up to four similarly sized pairs and at most 2,048 padded tokens. CPU reranking remains one pair at a time. Full GPU embedding batches default to eight; comparisons can select four or sixteen. Switching modes restarts the worker, clears caches and reruns the current query. The developer selection lasts until the panel closes.

GPU initialization/inference failures automatically replace the worker with a CPU-only worker and rerun the current query. Transformers.js 4.3.0's session initialization/inference promise chains remain rejected after an ORT failure, so loading a CPU model in the same worker is insufficient. Replacement also prevents old precision-specific vectors or relevance scores from leaking into the recovered search. Recovery remains on CPU until the panel closes or a mode is explicitly selected again. Metrics after fallback cover only the successful CPU attempt, excluding the failed attempt and restart.

## Reproduce and validate

The commands below evaluate the current GPU and CPU modes. Run `npm run assets` to verify/download every pinned variant, then `npm run check`. Start `npm run demo` in another terminal. Run:

```sh
EVAL_BACKEND=wasm EVAL_LABEL=cpu npm run evaluate
EVAL_BACKEND=auto EVAL_LABEL=hybrid npm run evaluate
EVAL_BACKEND=webgpu EVAL_BATCH_SIZE=8 EVAL_LABEL=gpu npm run evaluate
```

`EVAL_BASE_URL` can select another localhost port. Browser tests and the demo server accept `PORT`. If the default Playwright Chromium installation is incomplete, set `CHROMIUM_EXECUTABLE_PATH` to a working browser executable. Reports go to ignored `artifacts/`.

Validation covers real GPU inference, both GPU model initialization failures, a worker without `navigator.gpu`, mixed-length batch padding and row-output mapping, cancellation, caching, and cold offline extension loading in all three modes. Production permissions and offline-only CSP remain unchanged. Physical-device GPU acceptance is still unmeasured.

## Current assets and validation

The pinned LEAF q4f16 graph and external weights total 30,107,450 bytes (about 30.1 MB). The release bundles q4f16 GPU and q8 CPU LEAF, plus FP32 GPU and qint8 CPU Ettin. Total model/classifier weights are about 138.0 MB; tokenizers, runtime files, application code and licenses add to the package size. See the generated `artifacts/chrome-web-store/package-report.json` for the compressed release size.

Live Apple Inc. extension validation on the same desktop selected q4f16 WebGPU, processed 3,374 embedding inputs, and showed the founders in the top results. First-query model loading plus search took about 3.99 seconds, including 2.36 seconds of embedding inference. A different headquarters query reused the page vectors, inferred one query input, and took 143 ms. These are one-run observations, not a controlled speed comparison. See [compact live-page results](apple-gpu-validation.json).

Memory use and timing vary with hardware, browser, page size and context budget. Physical Safari/iPhone memory, latency and thermal testing remains necessary.
