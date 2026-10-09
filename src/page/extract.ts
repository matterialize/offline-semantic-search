import type { Passage, Snapshot } from '../types';

export const OWN_ATTRIBUTE = 'data-semantic-find';
const EXCLUDE = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEMPLATE', 'TEXTAREA', 'INPUT', 'SELECT', 'OPTION', 'SVG', 'CANVAS']);
const BLOCK = new Set(['P', 'DIV', 'SECTION', 'ARTICLE', 'MAIN', 'ASIDE', 'HEADER', 'FOOTER', 'NAV', 'LI', 'UL', 'OL', 'DT', 'DD', 'BLOCKQUOTE', 'PRE', 'TD', 'TH', 'TR', 'TABLE', 'FIGCAPTION', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6']);
const HEADING = 'h1,h2,h3,h4,h5,h6,[role="heading"]';
const CONTEXT_CONTAINER = 'section,article,main,aside,nav,header,footer,tr,blockquote,pre';
interface Point { node: Text; start: number; end: number }
interface Location { points: Point[]; text: string }

export class PageIndex {
  private version = 0;
  private locations = new Map<string, Location>();
  readonly roots = new Set<Document | ShadowRoot>();
  snapshot: Snapshot = { id: 0, passages: [], coverageNote: '' };

  constructor(private document: Document) {}

  extract(): Snapshot {
    const passages: Passage[] = [];
    const blocks: NonNullable<Snapshot['blocks']> = [];
    const locations = new Map<string, Location>();
    this.roots.clear();
    let inaccessible = 0;
    let headingNode: Element | null = null;
    let headingPath: Array<{ node: Element; level: number; ids: string[] }> = [];
    const nodeIds = new Map<Node, number>();
    const nodeId = (node: Node | null): number => {
      if (!node) return -1;
      if (!nodeIds.has(node)) nodeIds.set(node, nodeIds.size);
      return nodeIds.get(node)!;
    };
    let text = '';
    let points: Point[] = [];
    const segmenter = new Intl.Segmenter('en', { granularity: 'sentence' });
    const flush = () => {
      if (!text.trim()) { text = ''; points = []; return; }
      const sentences = [...segmenter.segment(text)].map((part) => {
        const leading = part.segment.length - part.segment.trimStart().length;
        const content = part.segment.trim();
        return { text: content, start: part.index + leading, end: part.index + leading + content.length };
      }).filter((part) => part.text.length > 0);
      const first = points[0].node;
      const root = first.getRootNode();
      const container = first.parentElement?.closest(CONTEXT_CONTAINER) ?? root;
      const heading = first.parentElement?.closest(HEADING);
      const kind = heading ? 'heading' : 'sentence';
      const contextGroup = `${nodeId(root)}:${nodeId(container)}:${nodeId(headingNode)}`;
      const blockId = String(blocks.length);
      const content = text.trim();
      const landmark = first.parentElement?.closest('nav,[role="navigation"],header,footer');
      const navigation = landmark && (landmark.matches('nav,[role="navigation"]') || !landmark.closest('main,article,[role="main"]'));
      const control = first.parentElement?.closest('button,[role="button"],a,[role="link"]');
      const standaloneControl = control && points.every((point) => control.contains(point.node));
      const reference = first.parentElement?.closest('[role="doc-bibliography"],[role="doc-endnotes"],[role="doc-endnote"],ol.references');
      const ownHeading = headingPath.find((item) => item.node === heading);
      const passageIds: string[] = [];
      for (let i = 0; i < sentences.length; i++) {
        const part = sentences[i];
        const id = `${this.version + 1}:${passages.length}`;
        const role = reference ? 'reference' : navigation ? 'navigation' : heading ? 'body' : standaloneControl ? 'control'
          : (part.text.match(/\p{L}[\p{L}\p{N}]*/gu)?.length ?? 0) < 4 ? 'fragment' : 'body';
        passages.push({ id, order: passages.length, text: part.text, kind, contextGroup, blockId,
          before: sentences[i - 1]?.text ?? '', after: sentences[i + 1]?.text ?? '',
          sentenceCount: heading ? 0 : 1, headingLevel: ownHeading?.level,
          sectionHeadingIds: headingPath.filter((item) => item.node !== heading && item.level !== 1).flatMap((item) => item.ids), role });
        locations.set(id, { text: part.text, points: points.slice(part.start, part.end) });
        passageIds.push(id);
        if (ownHeading) ownHeading.ids.push(id);
      }
      blocks.push({ id: blockId, text: content, passageIds });
      text = '';
      points = [];
    };
    const append = (node: Text) => {
      const value = node.data;
      for (let i = 0; i < value.length; i++) {
        const char = /\s/.test(value[i]) ? ' ' : value[i];
        if (char === ' ' && (!text || text.endsWith(' '))) continue;
        text += char;
        points.push({ node, start: i, end: i + 1 });
      }
    };
    const walk = (node: Node) => {
      if (node.nodeType === Node.TEXT_NODE) { append(node as Text); return; }
      if (node.nodeType !== Node.ELEMENT_NODE) return;
      const el = node as HTMLElement;
      if (el.hasAttribute(OWN_ATTRIBUTE) || EXCLUDE.has(el.tagName) || el.isContentEditable || el.hidden || el.getAttribute('aria-hidden') === 'true') { flush(); return; }
      const style = el.ownerDocument.defaultView?.getComputedStyle(el);
      if (style?.display === 'none' || style?.visibility === 'hidden' || style?.visibility === 'collapse' || style?.contentVisibility === 'hidden' || style?.opacity === '0') { flush(); return; }
      const isHeading = el.matches(HEADING);
      const scoped = el.matches('section,article,main,aside,nav,header,footer,[role="navigation"]');
      const outerPath = headingPath;
      const outerHeading = headingNode;
      const block = isHeading || el.matches('button,[role="button"]') || BLOCK.has(el.tagName) || ['block', 'flex', 'grid', 'table-cell', 'list-item'].includes(style?.display ?? '');
      if (block) flush();
      if (scoped) headingPath = [...headingPath];
      if (isHeading) {
        headingNode = el;
        const level = /^H[1-6]$/.test(el.tagName) ? Number(el.tagName[1]) : Number(el.getAttribute('aria-level')) || 2;
        headingPath = headingPath.filter((item) => item.level < level);
        headingPath.push({ node: el, level, ids: [] });
      }
      if (el.tagName === 'BR') { flush(); return; }
      if (el.tagName === 'IFRAME') {
        flush();
        const outerHeadingNode = headingNode;
        const savedPath = headingPath;
        headingNode = null;
        headingPath = [];
        try {
          const frame = el as HTMLIFrameElement;
          if (!frame.contentDocument?.body) inaccessible++;
          else { this.roots.add(frame.contentDocument); walk(frame.contentDocument.body); flush(); }
        } catch { inaccessible++; }
        headingNode = outerHeadingNode;
        headingPath = savedPath;
      } else if (el.shadowRoot) {
        flush();
        const outerHeadingNode = headingNode;
        const savedPath = headingPath;
        headingNode = null;
        headingPath = [];
        this.roots.add(el.shadowRoot);
        for (const child of el.shadowRoot.childNodes) walk(child);
        flush();
        headingNode = outerHeadingNode;
        headingPath = savedPath;
      } else if (el.tagName === 'SLOT') {
        const slot = el as HTMLSlotElement;
        const assigned = slot.assignedNodes({ flatten: true });
        for (const child of assigned.length ? assigned : el.childNodes) walk(child);
      } else if (el.tagName === 'DETAILS' && !(el as HTMLDetailsElement).open) {
        const summary = el.querySelector(':scope > summary');
        if (summary) walk(summary);
      } else {
        for (const child of el.childNodes) walk(child);
      }
      if (block) flush();
      if (scoped) { headingPath = outerPath; headingNode = outerHeading; }
    };
    this.roots.add(this.document);
    if (this.document.body) walk(this.document.body);
    flush();
    const subject = passages.find((passage) => passage.kind === 'heading' && passage.headingLevel === 1 && passage.role === 'body'
      && locations.get(passage.id)?.points[0]?.node.getRootNode() === this.document)?.text;
    const coverageNote = inaccessible ? 'Some embedded content cannot be searched on this page.' : '';
    const previous = this.snapshot;
    const unchanged = this.version > 0 && subject === previous.subject && coverageNote === previous.coverageNote && passages.length === previous.passages.length
      && passages.every((passage, i) => {
        const old = previous.passages[i];
        return passage.text === old.text && passage.kind === old.kind && passage.contextGroup === old.contextGroup
          && passage.blockId === old.blockId && passage.role === old.role && passage.headingLevel === old.headingLevel && passage.sentenceCount === old.sentenceCount
          && JSON.stringify((passage.sectionHeadingIds ?? []).map((id) => id.split(':')[1])) === JSON.stringify((old.sectionHeadingIds ?? []).map((id) => id.split(':')[1]));
      });
    this.locations = new Map();
    passages.forEach((passage, i) => {
      const location = locations.get(passage.id)!;
      if (unchanged) {
        passage.id = previous.passages[i].id;
        passage.sectionHeadingIds = previous.passages[i].sectionHeadingIds;
      }
      this.locations.set(passage.id, location);
    });
    if (!unchanged) this.version++;
    if (unchanged) blocks.forEach((block, i) => { block.passageIds = previous.blocks?.[i].passageIds ?? block.passageIds; });
    this.snapshot = { id: this.version, subject, passages, coverageNote, blocks };
    return this.snapshot;
  }

  blockRange(snapshotId: number, blockId: string): Range | null {
    const block = this.snapshot.blocks?.find((value) => value.id === blockId);
    if (snapshotId !== this.snapshot.id || !block) return null;
    const first = this.range(snapshotId, block.passageIds[0], 0, Number.MAX_SAFE_INTEGER);
    const last = this.range(snapshotId, block.passageIds.at(-1)!, 0, Number.MAX_SAFE_INTEGER);
    if (!first || !last || first.startContainer.getRootNode() !== last.endContainer.getRootNode()) return null;
    first.setEnd(last.endContainer, last.endOffset);
    return first;
  }

  range(snapshotId: number, id: string, start: number, end: number): Range | null {
    if (snapshotId !== this.snapshot.id) return null;
    const location = this.locations.get(id);
    if (!location) return null;
    const first = location.points[0];
    const last = location.points.at(-1);
    if (!first?.node.isConnected || !last?.node.isConnected) return null;
    const range = first.node.ownerDocument.createRange();
    try {
      range.setStart(first.node, first.start);
      range.setEnd(last.node, last.end);
      if (range.toString().replace(/\s+/g, ' ').trim() !== location.text) return null;
      const from = location.points[Math.max(0, Math.min(start, location.points.length - 1))];
      const to = location.points[Math.max(0, Math.min(end - 1, location.points.length - 1))];
      range.setStart(from.node, from.start);
      range.setEnd(to.node, to.end);
      return range;
    } catch { return null; }
  }
}

export function isOwnNode(node: Node): boolean {
  const el = node.nodeType === Node.ELEMENT_NODE ? node as Element : node.parentElement;
  return !!el?.closest(`[${OWN_ATTRIBUTE}]`);
}
