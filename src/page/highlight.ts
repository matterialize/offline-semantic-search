import { OWN_ATTRIBUTE } from './extract';

export class PageHighlight {
  private cleanup: Array<() => void> = [];
  private range: Range | undefined;

  clear() {
    for (const dispose of this.cleanup) dispose();
    this.cleanup = [];
    this.range = undefined;
  }

  show(range: Range, panel?: HTMLElement, surrounding: Range[] = [], scroll = true) {
    this.clear();
    this.range = range;
    const doc = range.startContainer.ownerDocument!;
    const win = doc.defaultView!;
    const element = range.startContainer.parentElement;
    const reduceMotion = win.matchMedia('(prefers-reduced-motion: reduce)').matches;
    // Centering works inside nested scroll containers, too.
    if (scroll) element?.scrollIntoView({ behavior: reduceMotion ? 'instant' : 'smooth', block: 'center', inline: 'nearest' });
    let frame = win.frameElement;
    while (scroll && frame) {
      frame.scrollIntoView({ behavior: reduceMotion ? 'instant' : 'smooth', block: 'center' });
      frame = frame.ownerDocument.defaultView?.frameElement ?? null;
    }

    const css = (win as unknown as { CSS: typeof CSS & { highlights?: Map<string, unknown> } }).CSS;
    const Highlight = (win as unknown as { Highlight?: new (...ranges: Range[]) => { priority: number } }).Highlight;
    const root = range.startContainer.getRootNode();
    const context = surrounding.filter((neighbor) => neighbor.startContainer.getRootNode() === root);
    if (css?.highlights && Highlight) {
      const style = doc.createElement('style');
      style.setAttribute(OWN_ATTRIBUTE, '');
      style.textContent = '::highlight(semantic-find-context) { background-color: #fff3cc; color: #302923; } ::highlight(semantic-find-active) { background-color: #ffe38a; color: #302923; text-decoration: underline; text-decoration-color: #ac7b13; }';
      (root.nodeType === Node.DOCUMENT_FRAGMENT_NODE ? root as ShadowRoot : doc.head ?? doc.documentElement).append(style);
      const activeHighlight = new Highlight(range);
      activeHighlight.priority = 2;
      if (context.length) {
        const contextHighlight = new Highlight(...context);
        contextHighlight.priority = 1;
        css.highlights.set('semantic-find-context', contextHighlight);
      }
      css.highlights.set('semantic-find-active', activeHighlight);
      this.cleanup.push(() => { css.highlights?.delete('semantic-find-active'); css.highlights?.delete('semantic-find-context'); style.remove(); });
    } else {
      const overlay = doc.createElement('div');
      overlay.setAttribute(OWN_ATTRIBUTE, '');
      overlay.style.cssText = 'position:fixed;inset:0;pointer-events:none;z-index:2147483645;';
      doc.documentElement.append(overlay);
      let queued = 0;
      const draw = () => {
        queued = 0;
        overlay.replaceChildren();
        for (const [ranges, active] of [[context, false], [[range], true]] as const) {
          for (const target of ranges) {
            for (const rect of target.getClientRects()) {
              if (!rect.width || !rect.height) continue;
              const mark = doc.createElement('div');
              mark.dataset.highlight = active ? 'active' : 'context';
              mark.style.cssText = `position:absolute;left:${rect.left}px;top:${rect.top}px;width:${rect.width}px;height:${rect.height}px;background:rgba(255,207,67,${active ? '.35' : '.17'});${active ? 'outline:1px solid #ac7b13;' : ''}border-radius:2px;`;
              overlay.append(mark);
            }
          }
        }
      };
      const schedule = () => { if (!queued) queued = win.requestAnimationFrame(draw); };
      win.addEventListener('scroll', schedule, true);
      win.addEventListener('resize', schedule);
      draw();
      this.cleanup.push(() => { overlay.remove(); win.cancelAnimationFrame(queued); win.removeEventListener('scroll', schedule, true); win.removeEventListener('resize', schedule); });
    }
    // Move evidence into the free region beside an upper dock or above a bottom dock.
    const adjust = () => {
      if (!scroll || this.range !== range || !panel || doc !== panel.ownerDocument) return;
      const rect = range.getBoundingClientRect();
      const dock = panel.getBoundingClientRect();
      if (rect.bottom > dock.top - 12 && rect.top < dock.bottom && rect.right > dock.left && rect.left < dock.right) {
        const viewport = win.visualViewport;
        const visibleTop = viewport?.offsetTop ?? 0;
        const visibleBottom = visibleTop + (viewport?.height ?? win.innerHeight);
        const below = visibleBottom - dock.bottom;
        const above = dock.top - visibleTop;
        const delta = below >= above
          ? rect.top - dock.bottom - 16
          : rect.bottom - dock.top + 16;
        win.scrollBy({ top: delta, behavior: reduceMotion ? 'instant' : 'smooth' });
      }
    };
    const timeout = win.setTimeout(adjust, reduceMotion ? 0 : 450);
    this.cleanup.push(() => win.clearTimeout(timeout));
  }
}
