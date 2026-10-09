import { createServer } from 'node:http';
import { watch } from 'node:fs';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';

process.chdir(fileURLToPath(new URL('../', import.meta.url)));
let revision = '';
let building = false;
let queued = false;
let stopping = false;
let child;
let debounce;
const server = createServer((req, res) => {
  if (req.method !== 'GET' || req.url !== '/version') { res.writeHead(404).end(); return; }
  res.writeHead(revision ? 200 : 503, { 'Content-Type': 'text/plain', 'Cache-Control': 'no-store' });
  res.end(revision);
});
server.on('error', (error) => {
  console.error(`Development reload server: ${error.message}`);
  shutdown(1);
});

async function rebuild() {
  if (stopping) return;
  if (building) { queued = true; return; }
  building = true;
  const next = randomUUID();
  console.log('Building development extension…');
  const code = await new Promise((resolve) => {
    child = spawn(process.execPath, ['scripts/build.mjs', '--dev', `--revision=${next}`], { stdio: 'inherit' });
    child.on('error', (error) => { console.error(error); resolve(1); });
    child.on('exit', resolve);
  });
  child = undefined;
  building = false;
  if (code === 0) {
    revision = next;
    console.log('Ready: load dist-dev/ at chrome://extensions. Saved changes reload the extension; reopen its panel with Option/Alt+Shift+F.');
  } else console.error('Build failed; no reload announced. Fix the error and save again.');
  if (queued && !stopping) { queued = false; void rebuild(); }
}

const onChange = (name) => {
  name = name.replaceAll('\\', '/');
  if (!name.startsWith('src/') && !name.startsWith('licenses/') && ![
    'scripts/build.mjs', 'manifest.json', 'model-lock.json', 'reranker-lock.json', 'panel.html', 'demo.html', 'NOTICE.md', 'package.json',
  ].includes(name)) return;
  clearTimeout(debounce);
  debounce = setTimeout(() => void rebuild(), 150);
};
const watchers = [
  watch('src', { recursive: true }, (_, filename) => onChange(`src/${filename ?? ''}`)),
  watch('licenses', { recursive: true }, (_, filename) => onChange(`licenses/${filename ?? ''}`)),
  watch('scripts', (_, filename) => onChange(`scripts/${filename ?? ''}`)),
  watch('.', (_, filename) => onChange(String(filename ?? ''))),
];
function shutdown(code = 0) {
  if (stopping) return;
  stopping = true;
  clearTimeout(debounce);
  watchers.forEach((watcher) => watcher.close());
  child?.kill();
  server.close(() => process.exit(code));
}
process.on('SIGINT', () => shutdown());
process.on('SIGTERM', () => shutdown());
server.listen(4174, '127.0.0.1', () => void rebuild());
