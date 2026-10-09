import { cp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import sharp from 'sharp';

const root = fileURLToPath(new URL('../', import.meta.url));
process.chdir(root);
const run = promisify(execFile);
const manifest = JSON.parse(await readFile('dist/manifest.json', 'utf8'));
const sourceManifest = JSON.parse(await readFile('manifest.json', 'utf8'));
if (JSON.stringify(manifest) !== JSON.stringify(sourceManifest)) throw new Error('Rebuild the production extension before packaging.');
if (manifest.manifest_version !== 3 || !manifest.background.service_worker || manifest.host_permissions
  || JSON.stringify(manifest.permissions) !== JSON.stringify(['activeTab', 'scripting'])) throw new Error('Unexpected release manifest permissions or background configuration.');
if (manifest.description.length > 132) throw new Error('Description exceeds the store limit.');
if ((await readFile('dist/background.js', 'utf8')).includes('127.0.0.1:4174')) throw new Error('Development reload code present.');
for (const [size, file] of Object.entries(manifest.icons)) {
  const metadata = await sharp(`dist/${file}`).metadata();
  if (metadata.width !== Number(size) || metadata.height !== Number(size)) throw new Error(`Invalid icon: ${file}`);
}
for (const name of ['model-lock.json', 'reranker-lock.json']) {
  const lock = JSON.parse(await readFile(name, 'utf8'));
  for (const asset of lock.files) {
    const bytes = await readFile(`dist/models/${lock.id}/${asset.path}`);
    if (createHash('sha256').update(bytes).digest('hex') !== asset.sha256) throw new Error(`Model checksum mismatch: ${asset.path}`);
  }
}
const release = path.resolve('artifacts/chrome-web-store');
const staging = path.join(release, 'extension');
await mkdir(release, { recursive: true });
await rm(staging, { recursive: true, force: true });
await mkdir(staging);
// Package the production extension, with the manifest at ZIP root. Exclude
// the web demo, source, test artifacts, screenshots and submission documents.
for (const name of ['manifest.json', 'panel.html', 'background.js', 'content.js', 'LICENSE', 'NOTICE.md', 'licenses', 'icons', 'runtime', 'models']) {
  await cp(`dist/${name}`, path.join(staging, name), { recursive: true });
}
await mkdir(path.join(staging, 'assets'));
for (const name of await readdir('dist/assets')) {
  if (name.startsWith('demo-') || name.endsWith('.map')) continue;
  await cp(`dist/assets/${name}`, path.join(staging, 'assets', name));
}
const output = path.join(release, `offline-semantic-search-v${manifest.version}.zip`);
await rm(output, { force: true });
await run('zip', ['-q', '-r', output, '.'], { cwd: staging });
await run('unzip', ['-tq', output]);
const bytes = await readFile(output);
const report = { version: manifest.version, sha256: createHash('sha256').update(bytes).digest('hex'), zipBytes: bytes.length,
  permissions: manifest.permissions, models: ['MongoDB/mdbr-leaf-ir', 'cross-encoder/ettin-reranker-17m-v1'],
  note: 'Prepared for manual dashboard upload; no store submission or publication performed.' };
await writeFile(path.join(release, 'package-report.json'), JSON.stringify(report, null, 2) + '\n');
console.log(`Release ZIP: ${path.relative(root, output)} (${(bytes.length / 1e6).toFixed(1)} MB)`);
console.log(`SHA-256: ${report.sha256}`);
