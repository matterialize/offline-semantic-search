import { build as viteBuild } from 'vite';
import { build as esbuild } from 'esbuild';
import { cp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import sharp from 'sharp';

const root = fileURLToPath(new URL('../', import.meta.url));
process.chdir(root);
const development = process.argv.includes('--dev');
const outDir = development ? 'dist-dev' : 'dist';
const revision = process.argv.find((arg) => arg.startsWith('--revision='))?.slice(11) ?? '';
const reloadUrl = development ? 'http://127.0.0.1:4174/version' : '';

await mkdir('public/icons', { recursive: true });
const icon = await readFile('src/icon.svg');
for (const size of [16, 32, 48, 128, 256, 512]) {
  await sharp(icon).resize(size, size).png().toFile(`public/icons/icon-${size}.png`);
}
const locks = await Promise.all(['model-lock.json', 'reranker-lock.json'].map(async (name) => JSON.parse(await readFile(name, 'utf8'))));
for (const lock of locks) for (const asset of lock.files) {
  const bytes = await readFile(`public/models/${lock.id}/${asset.path}`).catch(() => {
    throw new Error('Model assets are missing. Run npm run assets first.');
  });
  if (createHash('sha256').update(bytes).digest('hex') !== asset.sha256) {
    throw new Error(`Model checksum failed: ${asset.path}`);
  }
}
await rm('public/runtime', { recursive: true, force: true });
await mkdir('public/runtime', { recursive: true });
// Keep the matching ONNX JS loader and WASM together; never use its CDN default.
const runtimePath = 'node_modules/onnxruntime-web/dist';
for (const name of await readdir(runtimePath)) {
  if (name.endsWith('.wasm') || name.endsWith('.mjs')) {
    if (['ort-wasm-simd-threaded.mjs', 'ort-wasm-simd-threaded.wasm',
      'ort-wasm-simd-threaded.asyncify.mjs', 'ort-wasm-simd-threaded.asyncify.wasm'].includes(name)) {
      await cp(path.join(runtimePath, name), path.join('public/runtime', name));
    }
  }
}
await viteBuild({
  configFile: false,
  base: './',
  // Runtime paths are explicitly configured in the worker. Select ORT's
  // external-WASM entry to avoid also bundling an unused 27 MB fallback asset.
  resolve: { conditions: ['onnxruntime-web-use-extern-wasm', 'module', 'browser', 'development|production'] },
  build: {
    target: 'es2022',
    outDir,
    copyPublicDir: false,
    rollupOptions: { input: { panel: 'panel.html', demo: 'demo.html' } },
    chunkSizeWarningLimit: 1500,
  },
  worker: { format: 'es' },
});
// Bundle only the pinned model files; cached variants can remain in public/.
for (const name of await readdir('public')) {
  if (name !== 'models') await cp(path.join('public', name), path.join(outDir, name), { recursive: true });
}
for (const lock of locks) for (const asset of lock.files) {
  const relative = path.join('models', lock.id, asset.path);
  const dest = path.join(outDir, relative);
  await mkdir(path.dirname(dest), { recursive: true });
  await cp(path.join('public', relative), dest);
}
await esbuild({ entryPoints: ['src/content.ts'], bundle: true, format: 'iife', target: 'es2022', outfile: `${outDir}/content.js` });
await esbuild({ entryPoints: ['src/background.ts'], bundle: true, format: 'iife', target: 'es2022', outfile: `${outDir}/background.js`, define: { __DEV_RELOAD_URL__: JSON.stringify(reloadUrl), __DEV_REVISION__: JSON.stringify(revision) }, minifySyntax: true });
const manifest = JSON.parse(await readFile('manifest.json', 'utf8'));
if (development) {
  manifest.name += ' (Development)';
  manifest.host_permissions = ['http://127.0.0.1/*'];
  manifest.content_security_policy.extension_pages = manifest.content_security_policy.extension_pages.replace("connect-src 'self'", "connect-src 'self' http://127.0.0.1:4174");
}
await writeFile(`${outDir}/manifest.json`, `${JSON.stringify(manifest, null, 2)}\n`);
await cp('LICENSE', `${outDir}/LICENSE`);
await cp('NOTICE.md', `${outDir}/NOTICE.md`);
await cp('licenses', `${outDir}/licenses`, { recursive: true });
// Safari needs a background script list; Chrome uses its service worker.
const safariManifest = JSON.parse(await readFile('manifest.json', 'utf8'));
delete safariManifest.background.service_worker;
safariManifest.background.scripts = ['background.js'];
safariManifest.background.persistent = false;
await mkdir('artifacts', { recursive: true });
if (!development) await writeFile('artifacts/manifest.safari.json', `${JSON.stringify(safariManifest, null, 2)}\n`);
console.log(development ? 'Development extension built in dist-dev/.' : 'Offline extension built in dist/. Demo: npm run demo');
