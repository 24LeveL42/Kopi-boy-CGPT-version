import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { AutoplayTimer } from "@/lib/carousel-timer";

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

  it("does nothing until enabled, then moves on every 5 seconds", () => {
    vi.advanceTimersByTime(20_000);
    expect(advance).not.toHaveBeenCalled();
    timer.setEnabled(true);
    vi.advanceTimersByTime(4_999);
    expect(advance).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(advance).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(10_000);
    expect(advance).toHaveBeenCalledTimes(3);
  });

  it("pauses while touched and resumes 5 seconds after release", () => {
    timer.setEnabled(true);
    vi.advanceTimersByTime(3_000);
    timer.hold("touch");
    vi.advanceTimersByTime(60_000);
    expect(advance).not.toHaveBeenCalled();
    timer.release("touch");
    vi.advanceTimersByTime(4_999);
    expect(advance).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(advance).toHaveBeenCalledTimes(1);
  });

  it("stays paused until every hold is released (touch + hover + focus)", () => {
    timer.setEnabled(true);
    timer.hold("touch");
    timer.hold("hover");
    timer.hold("focus");
    timer.release("touch");
    timer.release("hover");
    vi.advanceTimersByTime(30_000);
    expect(advance).not.toHaveBeenCalled();
    timer.release("focus");
    vi.advanceTimersByTime(5_000);
    expect(advance).toHaveBeenCalledTimes(1);
  });

  it("ignores a release without a matching hold", () => {
    timer.setEnabled(true);
    vi.advanceTimersByTime(4_000);
    timer.release("touch");
    vi.advanceTimersByTime(1_000);
    expect(advance).toHaveBeenCalledTimes(1);
  });

  it("pauses while the tab is hidden and picks up again when it's visible", () => {
    timer.setEnabled(true);
    timer.setHidden(true);
    vi.advanceTimersByTime(60_000);
    expect(advance).not.toHaveBeenCalled();
    expect(timer.running).toBe(false);
    timer.setHidden(false);
    vi.advanceTimersByTime(5_000);
    expect(advance).toHaveBeenCalledTimes(1);
  });

  it("does not resume on release while the tab is still hidden", () => {
    timer.setEnabled(true);
    timer.hold("touch");
    timer.setHidden(true);
    timer.release("touch");
    vi.advanceTimersByTime(60_000);
    expect(advance).not.toHaveBeenCalled();
  });

  it("stops completely when disabled (one slide, or reduced motion)", () => {
    timer.setEnabled(true);
    timer.setEnabled(false);
    vi.advanceTimersByTime(60_000);
    expect(advance).not.toHaveBeenCalled();
  });

  it("restarts the full interval after the customer picks a slide", () => {
    timer.setEnabled(true);
    vi.advanceTimersByTime(4_000);
    timer.restart();
    vi.advanceTimersByTime(4_000);
    expect(advance).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1_000);
    expect(advance).toHaveBeenCalledTimes(1);
  });
});
