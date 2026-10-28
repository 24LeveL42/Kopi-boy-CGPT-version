import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { AutoplayTimer, HERO_SLIDE_MS } from "@/lib/carousel-timer";

describe("AutoplayTimer — hero carousel autoplay", () => {
  let advance: ReturnType<typeof vi.fn<() => void>>;
  let timer: AutoplayTimer;

  beforeEach(() => {
    vi.useFakeTimers();
    advance = vi.fn<() => void>();
    timer = new AutoplayTimer(advance);
  });
  afterEach(() => {
    timer.dispose();
    vi.useRealTimers();
  });

  it("moves on every 4 seconds, exactly", () => {
    expect(HERO_SLIDE_MS).toBe(4_000);
    timer.setEnabled(true);
    vi.advanceTimersByTime(3_999);
    expect(advance).toHaveBeenCalledTimes(0);
    vi.advanceTimersByTime(1);
    expect(advance).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(3_999);
    expect(advance).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(1);
    expect(advance).toHaveBeenCalledTimes(2);
  });

  it("runs non-stop: 10 minutes is exactly 150 slides", () => {
    timer.setEnabled(true);
    vi.advanceTimersByTime(600_000);
    expect(advance).toHaveBeenCalledTimes(150);
  });

  it("has no way to hold it: no hold, release or restart", () => {
    expect("hold" in timer).toBe(false);
    expect("release" in timer).toBe(false);
    expect("restart" in timer).toBe(false);
  });

  it("does nothing until enabled (more than one slide), and stops when disabled", () => {
    vi.advanceTimersByTime(20_000);
    expect(advance).not.toHaveBeenCalled();
    timer.setEnabled(true);
    vi.advanceTimersByTime(4_000);
    expect(advance).toHaveBeenCalledTimes(1);
    timer.setEnabled(false);
    vi.advanceTimersByTime(20_000);
    expect(advance).toHaveBeenCalledTimes(1);
    expect(timer.running).toBe(false);
  });

  it("pauses only while the tab is hidden, then gives the slide a full 4 seconds", () => {
    timer.setEnabled(true);
    vi.advanceTimersByTime(2_000);
    timer.setHidden(true);
    vi.advanceTimersByTime(60_000);
    expect(advance).not.toHaveBeenCalled();
    timer.setHidden(false);
    vi.advanceTimersByTime(3_999);
    expect(advance).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(advance).toHaveBeenCalledTimes(1);
  });

  it("ignores repeated calls that change nothing (no restart of the 4 seconds)", () => {
    timer.setEnabled(true);
    vi.advanceTimersByTime(3_000);
    timer.setEnabled(true);
    timer.setHidden(false);
    vi.advanceTimersByTime(1_000);
    expect(advance).toHaveBeenCalledTimes(1);
  });
});
