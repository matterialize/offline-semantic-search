import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = fileURLToPath(new URL('../', import.meta.url));
const lockPaths = ['model-lock.json', 'reranker-lock.json'].map((name) => path.join(root, name));
const refresh = process.argv.includes('--refresh-checksums');
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
for (const lockPath of lockPaths) {
  const lock = JSON.parse(await readFile(lockPath, 'utf8'));
  for (const asset of lock.files) {
    const dest = path.join(root, 'public/models', lock.id, asset.path);
    let bytes;
    try { bytes = await readFile(dest); } catch { /* Not downloaded yet. */ }
    if (refresh || !bytes || (asset.sha256 && sha256(bytes) !== asset.sha256)) {
      const url = `https://huggingface.co/${lock.id}/resolve/${lock.revision}/${asset.path}`;
      const response = await fetch(url);
      if (!response.ok) throw new Error(`${asset.path}: HTTP ${response.status}`);
      bytes = Buffer.from(await response.arrayBuffer());
    }
    const actual = sha256(bytes);
    if (refresh) asset.sha256 = actual;
    else if (actual !== asset.sha256) throw new Error(`Checksum mismatch: ${asset.path}`);
    await mkdir(path.dirname(dest), { recursive: true });
    await writeFile(dest, bytes);
    console.log(`Verified ${asset.path} (${bytes.length.toLocaleString()} bytes)`);
  }
  if (refresh) await writeFile(lockPath, `${JSON.stringify(lock, null, 2)}\n`);
}
