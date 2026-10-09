# Third-party notices

Copyright 2026 Matterialize. Original project code and original project artwork/documentation are licensed under Apache License 2.0; see `LICENSE`. Third-party material keeps the licenses described below.

This prototype includes the publisher’s q8 and q4f16 ONNX versions of `MongoDB/mdbr-leaf-ir`, revision `4262131b32c3182bd06e67e92ae69d7bd66e0c5c`, from https://huggingface.co/MongoDB/mdbr-leaf-ir (Apache License 2.0). LEAF IR was developed by MongoDB Research and distilled from Snowflake’s Arctic embedding model. Model weights have not been fine-tuned by this project. Its ONNX graph and external tensor data are pinned together in `model-lock.json`.

This prototype also includes `cross-encoder/ettin-reranker-17m-v1`, revision `9e4aa35321a6dd1a43ca313f500c4b4f7cfb5cc6`, from https://huggingface.co/cross-encoder/ettin-reranker-17m-v1 (Apache License 2.0). The publisher's `model_qint8_arm64.onnx` and FP32 `model.onnx` encoders and original Dense/LayerNorm/Dense classifier weights are pinned in `reranker-lock.json`. The ONNX encoder exports token states; this project implements the published CLS pooling and classifier operations in JavaScript, using an erf approximation for GELU. No model weights were fine-tuned or modified.

Transformers.js and Hugging Face Tokenizers: Apache License 2.0. ONNX Runtime and Hugging Face Jinja: MIT License. WebExtension Polyfill: Mozilla Public License 2.0. Vite's generated preload helper and its dependency notices are included under Vite's license. Their license texts are included in `licenses/` and copied into builds. The npm lockfile pins all runtime dependencies. Additional runtime dependency copyright/license texts and the upstream ONNX Runtime third-party notice inventory are included in `licenses/`. The ONNX inventory is an upstream superset; it does not imply that every listed component is shipped.

WebExtension Polyfill 0.12.0 is bundled without source modifications. Its MPL-2.0 source is available at https://github.com/mozilla/webextension-polyfill/tree/0.12.0 and is also included in `licenses/webextension-polyfill-source/`. Bundling/minification does not change its MPL source license.

Wikipedia text excerpts in evaluation reports and test fixtures retain CC BY-SA 4.0 licensing, attribution and modification notices in `docs/THIRD_PARTY_CONTENT.md`. They are not included in the store extension package. Model-derived test tensors retain their model's Apache-2.0 license.
