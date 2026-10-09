/** Owns debounce and job identity independently of DOM, worker, and model. */
export class SearchController {
  generation = 0;
  query = '';
  pending = false;
  private timer: ReturnType<typeof setTimeout> | undefined;

  constructor(private callbacks: {
    clear: (generation: number) => void;
    start: (generation: number, query: string) => void;
  }, private delay = 400) {}

  update(query: string) {
    this.query = query;
    this.invalidate();
    if (!query.trim()) return;
    this.pending = true;
    this.timer = setTimeout(() => this.flush(), this.delay);
  }

  flush() {
    if (!this.pending) return false;
    clearTimeout(this.timer);
    this.pending = false;
    this.callbacks.start(this.generation, this.query.trim());
    return true;
  }

  accepts(generation: number) { return generation === this.generation && !!this.query.trim(); }

  invalidate() {
    clearTimeout(this.timer);
    this.pending = false;
    this.callbacks.clear(++this.generation);
  }
}
