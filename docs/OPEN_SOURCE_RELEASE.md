# Open-source release preparation

Original project code, original artwork and original documentation: Apache-2.0, copyright 2026 Matterialize. `package.json` remains `private: true` to prevent accidental npm publication; this does not prevent an open-source GitHub repository.

## License audit

- Pinned LEAF IR and Ettin model revisions declare Apache-2.0 in their publisher metadata. Neither revision contains a separate LICENSE or NOTICE file. The Apache license and publisher/revision attribution are preserved in `LICENSE`, `licenses/Apache-2.0.txt` and `NOTICE.md`.
- Transformers.js and Hugging Face Tokenizers: Apache-2.0. Hugging Face Jinja and ONNX Runtime: MIT. Runtime dependency licenses/copyright notices are copied into `licenses/`; `runtime-dependencies.json` records versions and upstream metadata. ONNX Runtime's third-party notice inventory is copied from commit `8d85527a0`, matching the bundled web runtime revision. This inventory covers upstream components beyond the selected WASM build; listing a component does not mean it is shipped.
- WebExtension Polyfill: MPL-2.0. No source changes; bundling/minification only. Exact 0.12.0 source, API metadata and license are redistributed in `licenses/webextension-polyfill-source/` and linked in `NOTICE.md`. MPL applies to its covered source, not all original application files. [Mozilla distribution guidance](https://www.mozilla.org/en-US/MPL/2.0/FAQ/).
- Wikipedia excerpts: CC BY-SA 4.0, with separate attribution and modification notices in `THIRD_PARTY_CONTENT.md`. Evaluation data and fixtures are not shipped in the store ZIP.
- Sharp/libvips, native ONNX Runtime, Playwright/browser binaries and other development tools are not bundled in the extension. Their installed dependency licenses remain applicable if someone separately redistributes those binaries. The repository contains lockfiles, not their binary copies.
- The selected ONNX entry point is `onnxruntime-web/webgpu` (WASM also supported). `guid-typescript` belongs to the separate legacy WebGL entry point; its package declares ISC but supplies no LICENSE file. It is not imported by the selected entry point. Re-audit before changing runtime entry points.

This is a source/dependency attribution audit, not verification of publisher ownership of every model training example or a guarantee of model training-data rights. Model use follows the publishers' declared licenses.
