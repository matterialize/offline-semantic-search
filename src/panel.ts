import './panel.css';
import { SearchController } from './search/controller';
import { RERANK_MODEL, RERANK_RULES } from './search/reranker-config';
import { MODEL } from './search/embedding';
import { PREPROCESSING_VERSION } from './search/budget';
import { surroundingMatches, CONTEXT_MAX_PERCENT_DROP } from './search/context';
import { RANKING_RULES } from './search/ranking';
import { HYBRID_RULES } from './search/hybrid';
import { isRelevantResult, matchPercent, MIN_MATCH_PERCENT, relevanceScore } from './search/relevance';
import type { Transport } from './page/panel-host';
import type { BridgeMessage, Passage, SearchMetrics, SearchResult, Snapshot, WorkerRequest, WorkerResponse } from './types';

const $ = <T extends HTMLElement>(selector: string) => document.querySelector<T>(selector)!;
const input = $<HTMLInputElement>('#query');
const status = $('#status');
const resultsList = $('#results');
const scroller = $('#results-scroll');
const navigation = $('.navigation');
const position = $('#position');
const retry = $('#retry');
const coverage = $('#coverage');
const session = location.hash.slice(1);
let transport: Transport;
let snapshot: Snapshot | undefined;
let results: SearchResult[] = [];
let candidateScores: SearchResult[] = [];
let scores = new Map<string, SearchResult>();
let passages = new Map<string, Passage>();
let selected = -1;
let rendered = 0;
let metrics: SearchMetrics | undefined;
let cacheKey = '';
let backend: 'auto' | 'wasm' | 'webgpu' = 'auto';
let embeddingBatchSize = 8;
let fallbackReason: string | undefined;
let reranker = true;
let maxPairTokens: number = RERANK_RULES.maxPairTokens;
const cache = new Map<string, { results: SearchResult[]; scores: SearchResult[]; candidates: SearchResult[]; metrics: SearchMetrics }>();
let cacheSnapshot = -1;

if (location.protocol === 'http:' || location.protocol === 'https:') {
  const channel = new BroadcastChannel(`semantic-find-demo:${session}`);
  transport = { send: (message) => channel.postMessage(message), listen: (callback) => { channel.onmessage = (event) => callback(event.data); }, close: () => channel.close() };
} else {
  const { default: browser } = await import('webextension-polyfill');
  const port = browser.runtime.connect({ name: `panel:${session}` });
  let connected = true;
  // Active port messages keep MV3 routing alive during long offline searches.
  const heartbeat = setInterval(() => { if (connected) port.postMessage({ type: 'ping' }); }, 20_000);
  transport = { send: (message) => { if (connected) port.postMessage(message); }, listen: (callback) => port.onMessage.addListener((message) => callback(message as BridgeMessage)), close: () => { clearInterval(heartbeat); connected = false; port.disconnect(); } };
  port.onDisconnect.addListener(() => {
    connected = false;
    clearInterval(heartbeat);
    controller.invalidate();
    showError('The page connection closed. Reopen Offline Semantic Search to search again.');
  });
}

let worker: Worker;
function createWorker() {
  const instance = new Worker(new URL('./search/worker.ts', import.meta.url), { type: 'module' });
  instance.onmessage = (event: MessageEvent<WorkerResponse>) => {
    if (instance !== worker) return;
    const message = event.data;
    if (message.type === 'fallback') {
      controller.invalidate();
      instance.terminate();
      backend = 'wasm'; fallbackReason = message.reason;
      cache.clear(); worker = createWorker();
      controller.update(input.value); controller.flush();
      return;
    }
    if (!controller.accepts(message.generation)) return;
    if (message.type === 'error') { showError(message.message); return; }
    if (message.type === 'progress') {
      setStatus(message.total ? `${message.phase === 'rerank' ? 'Ranking matches' : 'Reading page'}… ${Math.floor(100 * message.completed / message.total)}%` : 'Searching…', true);
      return;
    }
    metrics = message.metrics;
    candidateScores = message.candidateScores;
    cache.set(cacheKey, { results: message.results, scores: message.sentenceScores, candidates: candidateScores, metrics });
    if (cache.size > 8) cache.delete(cache.keys().next().value!);
    display(message.results, message.sentenceScores);
  };
  instance.onerror = (event) => {
    if (instance !== worker) return;
    console.error('Search worker error', event.message);
    instance.terminate();
    showError('Search couldn’t start. Try again, or reload the extension.');
  };
  return instance;
}
worker = createWorker();
const post = (request: WorkerRequest) => worker.postMessage(request);
const resize = () => transport.send({ type: 'resize', height: 154 + $('.product-info').offsetHeight + (results.length ? Math.min(340, resultsList.scrollHeight) : 0) + (coverage.hidden ? 0 : coverage.offsetHeight + 16) + (retry.hidden ? 0 : 60) });
const setStatus = (text: string, loading = false) => {
  status.textContent = text;
  status.classList.toggle('searching', loading);
  resultsList.setAttribute('aria-busy', String(loading));
};

const controller = new SearchController({
  clear(generation) {
    post({ type: 'cancel', generation });
    try { transport.send({ type: 'clear' }); } catch { /* Disconnected. */ }
    results = [];
    candidateScores = [];
    scores.clear();
    metrics = undefined;
    selected = -1;
    rendered = 0;
    resultsList.replaceChildren();
    navigation.hidden = true;
    coverage.hidden = true;
    retry.hidden = true;
    setStatus(input.value.trim() ? 'Searching…' : 'Search by meaning, in your own words.', !!input.value.trim());
    resize();
  },
  start(generation) {
    setStatus('Searching…', true);
    try { transport.send({ type: 'extract', generation }); }
    catch { showError('Reopen Offline Semantic Search to search this page.'); }
  },
});

function showError(message: string) {
  setStatus(message);
  retry.hidden = false;
  resize();
}

function appendResults(to = rendered + 40) {
  const end = Math.min(results.length, to);
  const fragment = document.createDocumentFragment();
  for (let i = rendered; i < end; i++) {
    const result = results[i];
    const passage = passages.get(result.passageId)!;
    const li = document.createElement('li');
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'result';
    button.dataset.index = String(i);
    button.setAttribute('aria-current', String(i === selected));
    const sentence = document.createElement('span');
    sentence.className = 'sentence';
    // Center the preview on the winning evidence when the sentence is very long.
    const from = Math.max(0, result.start - 48);
    const text = result.paragraph?.text ?? passage.text;
    sentence.textContent = `${from ? '…' : ''}${text.slice(from, Math.max(from + 240, result.end))}`;
    button.title = text;
    button.dataset.kind = result.paragraph ? 'paragraph' : passage.kind;
    button.append(sentence);
    button.addEventListener('click', () => select(i));
    li.append(button);
    fragment.append(li);
  }
  resultsList.append(fragment);
  rendered = end;
}

function select(index: number) {
  if (!results.length || !snapshot) return;
  const old = resultsList.querySelector('[aria-current="true"]');
  old?.setAttribute('aria-current', 'false');
  selected = (index + results.length) % results.length;
  if (selected >= rendered) appendResults(selected + 40);
  const button = resultsList.querySelector<HTMLElement>(`[data-index="${selected}"]`);
  button?.setAttribute('aria-current', 'true');
  button?.scrollIntoView({ block: 'nearest' });
  position.textContent = `${selected + 1} of ${results.length}`;
  const result = results[selected];
  transport.send({ type: 'select', snapshotId: snapshot.id, result, context: result.paragraph ? [] : surroundingMatches(snapshot.passages, scores, result) });
}

function display(next: SearchResult[], allScores = next) {
  scores = new Map(allScores.map((result) => [result.passageId, result]));
  results = next.filter((result) => passages.has(result.passageId) && isRelevantResult(result));
  rendered = 0;
  selected = -1;
  resultsList.replaceChildren();
  setStatus(results.length ? 'Closest matches' : snapshot?.passages.length
    ? 'No close matches. Try another phrase.' : 'There is no text to search on this page.');
  navigation.hidden = !results.length;
  coverage.textContent = snapshot?.coverageNote ?? '';
  coverage.hidden = !coverage.textContent;
  appendResults();
  resize();
  if (results.length) select(0);
}

transport.listen((message: BridgeMessage) => {
  if (message.type === 'focus') { input.focus(); input.select(); }
  if (message.type === 'changed') { cache.clear(); controller.update(input.value); }
  if (message.type === 'error') showError(message.message);
  if (message.type !== 'snapshot' || !controller.accepts(message.generation)) return;
  snapshot = message.snapshot;
  passages = new Map(snapshot.passages.map((passage) => [passage.id, passage]));
  if (cacheSnapshot !== snapshot.id) { cache.clear(); cacheSnapshot = snapshot.id; }
  cacheKey = JSON.stringify([snapshot.id, controller.query.trim(), PREPROCESSING_VERSION, reranker, maxPairTokens]);
  const cached = cache.get(cacheKey);
  if (cached) { metrics = cached.metrics; candidateScores = cached.candidates; display(cached.results, cached.scores); return; }
  if (!snapshot.passages.length) { metrics = undefined; display([]); return; }
  post({ type: 'search', generation: message.generation, query: controller.query.trim(), snapshot, reranker, maxPairTokens, backend, embeddingBatchSize, fallbackReason, assetBase: new URL('./', location.href).href });
});

input.addEventListener('input', (event) => {
  if (!(event as InputEvent).isComposing) controller.update(input.value);
});
input.addEventListener('compositionstart', () => controller.invalidate());
input.addEventListener('compositionend', () => controller.update(input.value));
$('#search-form').addEventListener('submit', (event) => event.preventDefault());
document.addEventListener('keydown', (event) => {
  if (event.isComposing) return;
  if (event.key === 'Escape') { event.preventDefault(); close(); }
  if (event.key === 'Enter' && event.target === input) {
    event.preventDefault();
    if (!controller.flush()) select(selected + (event.shiftKey ? -1 : 1));
  }
});
$('#previous').addEventListener('click', () => select(selected - 1));
$('#next').addEventListener('click', () => select(selected + 1));
$('#close').addEventListener('click', close);
retry.addEventListener('click', () => { worker.terminate(); worker = createWorker(); controller.update(input.value); controller.flush(); });
function close() { controller.invalidate(); worker.terminate(); transport.send({ type: 'close' }); }
window.addEventListener('pagehide', () => { worker.terminate(); transport.close(); });
new IntersectionObserver((entries) => {
  if (entries.some((entry) => entry.isIntersecting) && rendered < results.length) appendResults();
}, { root: scroller, rootMargin: '200px' }).observe($('#sentinel'));

// Developer-only, explicitly invoked local export. Nothing is uploaded or persisted.
Object.assign(window, { semanticFindDev: {
  metrics: () => metrics,
  setBackend: (value: 'auto' | 'wasm' | 'webgpu', batch = 8) => {
    if (!['auto', 'wasm', 'webgpu'].includes(value) || ![4, 8, 16].includes(batch)) throw new Error('Invalid inference configuration');
    controller.invalidate();
    worker.terminate();
    backend = value; embeddingBatchSize = batch; fallbackReason = undefined;
    cache.clear(); worker = createWorker();
    controller.update(input.value); controller.flush();
  },
  setReranker: (enabled: boolean) => { reranker = !!enabled; controller.update(input.value); controller.flush(); },
  setContextTokens: (tokens: number) => {
    if (!Number.isInteger(tokens) || tokens < 256 || tokens > RERANK_RULES.nativeMaxPairTokens) throw new Error('Context must be 256–7999 tokens');
    maxPairTokens = tokens; controller.update(input.value); controller.flush();
  },
  settings: () => ({ backend, embeddingBatchSize, preprocessing: PREPROCESSING_VERSION, reranker: reranker ? RERANK_MODEL : undefined, rerankRules: { ...RERANK_RULES, maxPairTokens }, rankingRules: RANKING_RULES, hybridRules: HYBRID_RULES, retrievalEvidencePercent: MIN_MATCH_PERCENT, maximumContextPercentDrop: CONTEXT_MAX_PERCENT_DROP }),
  candidates: () => candidateScores.map((result) => ({ ...result, accepted: isRelevantResult(result), text: result.paragraph?.text ?? passages.get(result.passageId)?.text })),
  results: () => results.map((result) => ({ ...result, matchPercent: matchPercent(relevanceScore(result)), semanticPercent: matchPercent(result.score), text: result.paragraph?.text ?? passages.get(result.passageId)?.text, kind: result.paragraph ? 'paragraph' : passages.get(result.passageId)?.kind })),
  scores: () => [...scores.values()].map((result) => ({ ...result, matchPercent: matchPercent(relevanceScore(result)), semanticPercent: matchPercent(result.score), text: passages.get(result.passageId)?.text })),
  exportLabels: (labels: Record<string, boolean>) => {
    const rows = [...scores.values()].filter((result) => typeof labels[result.passageId] === 'boolean').map((result) => JSON.stringify({
      query: input.value, effectiveQuery: metrics?.effectiveQuery ?? input.value, passage: passages.get(result.passageId)?.text, relevant: labels[result.passageId],
      score: result.score, evidenceScore: relevanceScore(result), ranking: result.ranking, model: MODEL, preprocessing: PREPROCESSING_VERSION,
    }));
    const url = URL.createObjectURL(new Blob([rows.join('\n') + '\n'], { type: 'application/x-ndjson' }));
    const anchor = document.createElement('a'); anchor.href = url; anchor.download = 'semantic-find-labels.jsonl'; anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    return rows.length;
  },
} });
resize();
requestAnimationFrame(() => input.focus());
