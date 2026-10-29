"use client";

import { useEffect, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { BRAND_NAME } from "@/lib/brand";
import { AutoplayTimer, HERO_SLIDE_MOVE_MS } from "@/lib/carousel-timer";
import { HERO_IMAGES, nextHeroImage, showingHeroImages, type HeroImage } from "@/lib/hero-slides";

const SIZES = "(max-width: 600px) 100vw, 560px";

interface CarouselState {
  /** The slide on show. */
  current: string;
  /** The slide moving out to the left, until its move is over. */
  leaving: string | null;
  /** The next slide, loaded ahead of time so it never slides in blank. */
  upNext: string;
  /** The images in rotation (seasonal ones only inside their window), for the dots and labels. */
  showing: string[];
}

function stateAt(current: string, leaving: string | null, now: number, images: readonly HeroImage[]): CarouselState {
  return {
    current,
    leaving,
    upNext: nextHeroImage(current, now, images).key,
    showing: showingHeroImages(now, images).map((image) => image.key),
  };
}

/** The first image is the page's largest picture, so it is preloaded; the rest are lazy, except the one coming in next. */
function HeroImageSlide({ image, href, eager, first }: { image: HeroImage; href: string | null; eager: boolean; first: boolean }) {
  const picture = (
    <Image
      src={image.src}
      alt={image.alt}
      fill
      sizes={SIZES}
      preload={first}
      fetchPriority={first ? "high" : undefined}
      loading={first || eager ? "eager" : "lazy"}
      className="kb-hero-image"
      draggable={false}
    />
  );
  return href ? (
    <Link href={href} className="kb-hero-slide" draggable={false}>
      {picture}
    </Link>
  ) : (
    <div className="kb-hero-slide">{picture}</div>
  );
}

/**
 * The home hero: the designed images in HERO_IMAGES, one at a time in a
 * fixed 2:1 frame (560 x 280 at most), so the page never moves.
 *
 * Every slide stays exactly 4 seconds, non-stop: nothing pauses it except a
 * hidden browser tab. It only ever moves forward — the next slide comes in
 * from the right and the current one leaves to the left, and after the last
 * slide the first one comes in from the right the same way. There are no
 * arrows, no swipe or drag and no arrow keys; the dots, in their own row
 * under the picture so they never cover the artwork, only show the position. Seasonal images are checked against their Singapore dates at
 * every slide change. With prefers-reduced-motion the slides change by an
 * instant cut instead of sliding, on the same 4-second beat.
 *
 * The images that link (cooking-nearby and the festive ones) go to the All
 * Cooks & Stalls list, and only while that list is on the page.
 */
export function HomeCarousel({ allCooksId, images = HERO_IMAGES }: { allCooksId: string | null; images?: readonly HeroImage[] }) {
  const [state, setState] = useState<CarouselState>(() => {
    const now = Date.now();
    return stateAt(showingHeroImages(now, images)[0]?.key ?? images[0].key, null, now, images);
  });
  const rotating = state.showing.length > 1;

  useEffect(() => {
    const timer = new AutoplayTimer(() => {
      const now = Date.now();
      setState((s) => {
        const next = nextHeroImage(s.current, now, images).key;
        return next === s.current ? stateAt(s.current, s.leaving, now, images) : stateAt(next, s.current, now, images);
      });
    });
    const onVisibility = () => timer.setHidden(document.visibilityState === "hidden");
    onVisibility();
    timer.setEnabled(rotating);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      timer.dispose();
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [images, rotating]);

  // Once the old slide has left, park it back on the right (hidden), ready to come in again.
  useEffect(() => {
    if (!state.leaving) return;
    const leaving = state.leaving;
    const done = setTimeout(() => setState((s) => (s.leaving === leaving ? { ...s, leaving: null } : s)), HERO_SLIDE_MOVE_MS + 100);
    return () => clearTimeout(done);
  }, [state.leaving]);

  const position = state.showing.indexOf(state.current);

  return (
    <section className="kb-hero-carousel" aria-roledescription="carousel" aria-label={`Featured on ${BRAND_NAME}`}>
      <div className="kb-hero-viewport">
        {images.map((image, i) => {
          const isCurrent = image.key === state.current;
          const place = isCurrent ? "is-current" : image.key === state.leaving ? "is-leaving" : "is-waiting";
          const n = state.showing.indexOf(image.key);
          return (
            <div
              key={image.key}
              role="group"
              aria-roledescription="slide"
              aria-label={n >= 0 ? `${n + 1} of ${state.showing.length}` : undefined}
              aria-hidden={isCurrent ? undefined : true}
              inert={!isCurrent}
              className={`kb-hero-frame ${place}`}
              data-key={image.key}
            >
              <HeroImageSlide
                image={image}
                href={image.linksToAllCooks && allCooksId ? `#${allCooksId}` : null}
                eager={isCurrent || image.key === state.upNext}
                first={i === 0}
              />
            </div>
          );
        })}
      </div>
      {/* Always there (empty for a single slide) so its height never changes. */}
      <div className="kb-hero-dots" aria-hidden="true" data-position={position}>
        {rotating && state.showing.map((key) => <span key={key} className={key === state.current ? "is-active" : undefined} />)}
      </div>
    </section>
  );
}
