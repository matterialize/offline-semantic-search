import { cp, mkdir, rm, access } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

process.chdir(fileURLToPath(new URL('../', import.meta.url)));
await rm('artifacts/safari-extension', { recursive: true, force: true });
await mkdir('artifacts/safari-extension', { recursive: true });
await cp('dist', 'artifacts/safari-extension', { recursive: true });
await cp('artifacts/manifest.safari.json', 'artifacts/safari-extension/manifest.json');
const exists = await access('safari/Offline Semantic Search/Offline Semantic Search.xcodeproj').then(() => true, () => false);
if (exists && !process.argv.includes('--regenerate')) {
  console.log('Safari resources refreshed. Existing Xcode project and signing settings preserved.');
  process.exit(0);
}
const result = spawnSync('xcrun', ['safari-web-extension-converter', 'artifacts/safari-extension', '--project-location', 'safari', '--app-name', 'Offline Semantic Search', '--bundle-identifier', 'com.matterialize.semanticfind', '--swift', '--no-open', '--no-prompt', '--force'], { stdio: 'inherit' });
process.exit(result.status ?? 1);
