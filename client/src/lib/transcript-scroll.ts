export const BOTTOM_THRESHOLD = 80;
/** Owns only the transcript scroll position, never the document or keyboard focus. */
export class TranscriptScroll {
  private following = true;
  private unread = new Set<string>();
  private known = new Set<string>();
  private anchors: Array<{ id: string; offset: number }> = [];
  constructor(private element: HTMLElement, private notify: (count: number) => void) {}
  private nearBottom() { return this.element.scrollHeight-this.element.clientHeight-this.element.scrollTop <= BOTTOM_THRESHOLD; }
  private capture() {
    const top = this.element.getBoundingClientRect().top;
    this.anchors = [];
    for (const node of this.element.querySelectorAll<HTMLElement>('[data-message-id]')) {
      const bounds = node.getBoundingClientRect();
      if (bounds.bottom > top && this.anchors.length < 4) this.anchors.push({ id: node.dataset.messageId!,offset: bounds.top-top });
      if (this.anchors.length === 4) break;
    }
  }
  onScroll = () => {
    this.following = this.nearBottom();
    if (this.following) this.clear();
    this.capture();
  };
  beforeMessage(id: string, own: boolean) {
    if (this.known.has(id)) return;
    this.known.add(id);
    if (own) this.following = true;
    if (!this.following) { this.unread.add(id); this.notify(this.unread.size); }
  }
  sync(ids: string[]) {
    ids.forEach(id => this.known.add(id));
    const current = new Set(ids);
    for (const id of this.unread) if (!current.has(id)) this.unread.delete(id);
    this.notify(this.unread.size);
    this.restore();
  }
  restore = () => {
    if (this.following) { this.element.scrollTop = this.element.scrollHeight; this.clear(); }
    else {
      const nodes = [...this.element.querySelectorAll<HTMLElement>('[data-message-id]')];
      for (const anchor of this.anchors) {
        const node = nodes.find(node => node.dataset.messageId === anchor.id);
        if (node) { this.element.scrollTop += node.getBoundingClientRect().top-this.element.getBoundingClientRect().top-anchor.offset; break; }
      }
    }
    this.capture();
  };
  newest = () => { this.following = true; this.restore(); };
  private clear() { if (this.unread.size) { this.unread.clear(); this.notify(0); } }
}
