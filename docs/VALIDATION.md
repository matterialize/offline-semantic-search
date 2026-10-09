# Release validation

The current pipeline uses q4f16 WebGPU LEAF retrieval, FP32 WebGPU Ettin reranking, and quantized CPU fallback. Pinned asset checksums are verified during every build. The current live-page observation is recorded in [apple-gpu-validation.json](apple-gpu-validation.json); it is a single desktop run, not a controlled benchmark or physical-phone measurement.

## Automated checks

```sh
npm run check
npx playwright install chromium
npm run test:browser
npm run package:store
```

Unit and browser tests cover token budgets and full tail coverage, section context, body-only result rows and highlights, reranking filters, batching, cancellation, cache reuse, theme accessibility, GPU inference and CPU recovery. The extension test disables network access before initial model loading and exercises a page with restrictive CSP. Store packaging validates production permissions, model checksums, icon sizes and ZIP integrity.

`npm run evaluate` runs six synthetic development queries and a long-page case with the demo server running. Reports are written to ignored `artifacts/`. These fixtures are not a held-out quality benchmark. LEAF eligibility, the top-40 shortlist and Ettin display cutoffs can exclude relevant passages; scores are not answer probabilities.

## Device acceptance

Before claiming Safari/mobile support, test the signed extension on physical target devices. Check cold loading, long paragraphs, large pages, repeated queries, cancellation, navigation and highlight placement. Record latency, peak memory, page reloads or worker termination, battery use and heat. Desktop Chromium and narrow viewport screenshots do not establish phone reliability.

Chrome Web Store submission also requires a publicly hosted privacy policy, final listing review and manual dashboard upload. See [CHROMEWEBSTORE.md](../CHROMEWEBSTORE.md).
