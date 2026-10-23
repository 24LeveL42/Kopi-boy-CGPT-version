"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { BRAND_NAME } from "@/lib/brand";
import { AutoplayTimer, type HoldReason } from "@/lib/carousel-timer";
import type { HeroSlide } from "@/lib/hero-slides";
import { LogoCard } from "./LogoCard";
import { FallbackSlide, FlashSlide, NewKitchenSlide, PromotionSlide } from "./HeroSlides";

const DRAG_START_PX = 6;
const DRAG_SWITCH_PX = 40;

function reducedMotion(): boolean {
  return typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true;
}

/** Keyboard focus pauses autoplay; a mouse click that leaves focus on a dot doesn't keep it paused. */
function keyboardFocus(el: Element): boolean {
  try {
    return el.matches(":focus-visible");
  } catch {
    return true;
  }
}

function Slide({ slide, allCooksId }: { slide: HeroSlide; allCooksId: string | null }) {
  switch (slide.type) {
    case "brand":
      return <LogoCard />;
    case "new-kitchen":
      return <NewKitchenSlide kitchen={slide.kitchen} image={slide.image} />;
    case "promotion":
      return <PromotionSlide kitchen={slide.kitchen} deal={slide.deal} image={slide.image} />;
    case "flash":
      return <FlashSlide kitchen={slide.kitchen} deal={slide.deal} image={slide.image} />;
    case "fallback":
      return <FallbackSlide allCooksId={allCooksId} />;
  }
}

/**
 * The home hero as a carousel. Slide A is the existing brand hero
 * (<LogoCard/>, unchanged) and sets the height; every other slide is
 * absolutely positioned inside the same box, so nothing on the page moves.
 * Swipe is native scroll-snap; a mouse can drag, scroll sideways, use the
 * hover arrows, the dots or the arrow keys. Autoplay (src/lib/carousel-
 * timer.ts) pauses while touched, hovered or focused and while the tab is
 * hidden, and is off with prefers-reduced-motion.
 */
export function HomeCarousel({ slides, allCooksId }: { slides: HeroSlide[]; allCooksId: string | null }) {
  const trackRef = useRef<HTMLDivElement>(null);
  const timerRef = useRef<AutoplayTimer | null>(null);
  const indexRef = useRef(0);
  const countRef = useRef(slides.length);
  const drag = useRef<{ x: number; left: number; moved: boolean } | null>(null);
  const suppressClick = useRef(false);
  const [index, setIndex] = useState(0);
  const count = slides.length;
  const current = Math.min(index, count - 1);

  const goTo = useCallback((target: number) => {
    const track = trackRef.current;
    const n = countRef.current;
    if (!track || n < 1) return;
    const next = ((target % n) + n) % n;
    indexRef.current = next;
    setIndex(next);
    const left = next * track.clientWidth;
    if (typeof track.scrollTo === "function") track.scrollTo({ left, behavior: reducedMotion() ? "auto" : "smooth" });
    else track.scrollLeft = left;
  }, []);

  useEffect(() => {
    const timer = new AutoplayTimer(() => goTo(indexRef.current + 1));
    timerRef.current = timer;
    const motion = window.matchMedia?.("(prefers-reduced-motion: reduce)");
    const sync = () => timer.setEnabled(countRef.current > 1 && !motion?.matches);
    const onVisibility = () => timer.setHidden(document.visibilityState === "hidden");
    sync();
    onVisibility();
    motion?.addEventListener?.("change", sync);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      timer.dispose();
      timerRef.current = null;
      motion?.removeEventListener?.("change", sync);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [goTo]);

  // Slides arrive after the page loads (location, live data): keep the timer and position in step.
  useEffect(() => {
    countRef.current = count;
    if (indexRef.current >= count) goTo(0);
    timerRef.current?.setEnabled(count > 1 && !reducedMotion());
  }, [count, goTo]);

  const hold = (reason: HoldReason) => timerRef.current?.hold(reason);
  const release = (reason: HoldReason) => timerRef.current?.release(reason);
  const pick = (target: number) => {
    goTo(target);
    timerRef.current?.restart();
  };

  const onScroll = () => {
    const track = trackRef.current;
    if (!track || drag.current?.moved || !track.clientWidth) return;
    const at = Math.round(track.scrollLeft / track.clientWidth);
    if (at !== indexRef.current && at >= 0 && at < countRef.current) {
      indexRef.current = at;
      setIndex(at);
    }
  };

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.pointerType !== "mouse") return hold("touch");
    if (e.button !== 0 || count < 2) return;
    drag.current = { x: e.clientX, left: e.currentTarget.scrollLeft, moved: false };
  };
  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!d) return;
    const dx = e.clientX - d.x;
    if (!d.moved) {
      if (Math.abs(dx) < DRAG_START_PX) return;
      d.moved = true;
      hold("drag");
      e.currentTarget.setPointerCapture?.(e.pointerId);
      e.currentTarget.classList.add("is-dragging");
    }
    e.currentTarget.scrollLeft = d.left - dx;
  };
  const endPointer = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.pointerType !== "mouse") return release("touch");
    const d = drag.current;
    drag.current = null;
    if (!d?.moved) return;
    e.currentTarget.classList.remove("is-dragging");
    suppressClick.current = true;
    const width = e.currentTarget.clientWidth || 1;
    const from = Math.round(d.left / width);
    const dx = e.clientX - d.x;
    goTo(Math.max(0, Math.min(count - 1, dx < -DRAG_SWITCH_PX ? from + 1 : dx > DRAG_SWITCH_PX ? from - 1 : from)));
    release("drag");
  };
  const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
    e.preventDefault();
    pick(indexRef.current + (e.key === "ArrowRight" ? 1 : -1));
  };

  return (
    <section
      className="kb-hero-carousel"
      aria-roledescription="carousel"
      aria-label={`Featured on ${BRAND_NAME}`}
      onPointerEnter={(e) => e.pointerType === "mouse" && hold("hover")}
      onPointerLeave={(e) => e.pointerType === "mouse" && release("hover")}
      onFocus={(e) => keyboardFocus(e.target) && hold("focus")}
      onBlur={(e) => !e.currentTarget.contains(e.relatedTarget as Node | null) && release("focus")}
    >
      <div
        ref={trackRef}
        className="kb-hero-track"
        tabIndex={count > 1 ? 0 : -1}
        aria-label={count > 1 ? "Use the left and right arrow keys to change slides" : undefined}
        onScroll={onScroll}
        onKeyDown={onKeyDown}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endPointer}
        onPointerCancel={endPointer}
        onClickCapture={(e) => {
          if (!suppressClick.current) return;
          suppressClick.current = false;
          e.preventDefault();
          e.stopPropagation();
        }}
        onDragStart={(e) => e.preventDefault()}
      >
        {slides.map((slide, i) => (
          <div key={slide.key} role="group" aria-roledescription="slide" aria-label={`${i + 1} of ${count}`} className="kb-hero-frame" inert={i !== current}>
            <Slide slide={slide} allCooksId={allCooksId} />
          </div>
        ))}
      </div>
      {count > 1 && (
        <>
          <button type="button" className="kb-hero-arrow is-prev" aria-label="Previous slide" onClick={() => pick(current - 1)}>
            ‹
          </button>
          <button type="button" className="kb-hero-arrow is-next" aria-label="Next slide" onClick={() => pick(current + 1)}>
            ›
          </button>
          <div className="kb-hero-dots">
            {slides.map((slide, i) => (
              <button key={slide.key} type="button" aria-label={`Show slide ${i + 1} of ${count}`} aria-current={i === current ? "true" : undefined} className={i === current ? "is-active" : undefined} onClick={() => pick(i)} />
            ))}
          </div>
        </>
      )}
    </section>
  );
}
