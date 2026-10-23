/** The hero carousel moves on every 5 seconds, and waits 5 seconds after the customer lets go. */
export const HERO_INTERVAL_MS = 5_000;
export const HERO_RESUME_MS = 5_000;

export type HoldReason = "touch" | "hover" | "focus" | "drag";

/**
 * Autoplay for the hero carousel, kept free of React and the DOM so it can
 * be tested with fake timers. It only runs while enabled (more than one
 * slide, no reduced-motion preference), the tab is visible and nothing is
 * holding it (a finger, the mouse, keyboard focus, a drag). Letting go
 * waits HERO_RESUME_MS before the next slide.
 */
export class AutoplayTimer {
  private holds = new Set<HoldReason>();
  private enabled = false;
  private hidden = false;
  private timer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private readonly onAdvance: () => void,
    private readonly intervalMs = HERO_INTERVAL_MS,
    private readonly resumeDelayMs = HERO_RESUME_MS
  ) {}

  get running(): boolean {
    return this.timer !== null;
  }

  setEnabled(enabled: boolean) {
    if (enabled === this.enabled) return;
    this.enabled = enabled;
    this.schedule(this.intervalMs);
  }

  setHidden(hidden: boolean) {
    if (hidden === this.hidden) return;
    this.hidden = hidden;
    this.schedule(this.intervalMs);
  }

  hold(reason: HoldReason) {
    this.holds.add(reason);
    this.clear();
  }

  release(reason: HoldReason) {
    if (!this.holds.delete(reason)) return;
    this.schedule(this.resumeDelayMs);
  }

  /** After the customer picks a slide (dot, arrow key): a full interval before the next one. */
  restart() {
    this.schedule(this.intervalMs);
  }

  dispose() {
    this.enabled = false;
    this.clear();
  }

  private clear() {
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
  }

  private schedule(delay: number) {
    this.clear();
    if (!this.enabled || this.hidden || this.holds.size > 0) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      this.onAdvance();
      this.schedule(this.intervalMs);
    }, delay);
  }
}
