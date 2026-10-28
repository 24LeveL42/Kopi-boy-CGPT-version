/** Every hero slide stays exactly this long, then the next one comes in. */
export const HERO_SLIDE_MS = 4_000;
/** How long the slide-in takes (the CSS transition on .kb-hero-frame); part of the 4 seconds, not added to them. */
export const HERO_SLIDE_MOVE_MS = 600;

/**
 * Autoplay for the hero carousel, kept free of React and the DOM so it can
 * be tested with fake timers. It moves on every HERO_SLIDE_MS while enabled
 * (more than one slide) and never pauses for a finger, the mouse or keyboard
 * focus. The only pause is while the browser tab is hidden, where nobody can
 * see it; when the tab is visible again the current slide gets a full
 * HERO_SLIDE_MS.
 */
export class AutoplayTimer {
  private enabled = false;
  private hidden = false;
  private timer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private readonly onAdvance: () => void,
    private readonly intervalMs = HERO_SLIDE_MS
  ) {}

  get running(): boolean {
    return this.timer !== null;
  }

  setEnabled(enabled: boolean) {
    if (enabled === this.enabled) return;
    this.enabled = enabled;
    this.schedule();
  }

  setHidden(hidden: boolean) {
    if (hidden === this.hidden) return;
    this.hidden = hidden;
    this.schedule();
  }

  dispose() {
    this.enabled = false;
    this.clear();
  }

  private clear() {
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
  }

  private schedule() {
    this.clear();
    if (!this.enabled || this.hidden) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      this.onAdvance();
      this.schedule();
    }, this.intervalMs);
  }
}
