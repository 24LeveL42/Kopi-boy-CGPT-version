"use client";

import Image from "next/image";
import Link from "next/link";
import { useNow } from "@/lib/use-now";
import { describeDeal, dealHref, formatEndsIn, type KitchenDeal } from "@/lib/deals";
import type { Merchant } from "@/lib/types";

/**
 * Hero carousel slides built from live kitchen data — no invented wording —
 * plus the designed brand banners. Every slide fills the brand hero's box
 * exactly (.kb-hero-slide is absolutely positioned), so swapping slides never
 * moves the page. Images are lazy: only the brand slide's photo loads up front.
 */

const SIZES = "(max-width:768px) 100vw, 700px";
const CATEGORY_LABEL: Record<Merchant["category"], string> = { "home-cook": "Home Cook", hawker: "Hawker", bakery: "Bakery", "bulk-orders": "Local Seller", drinks: "Desserts & Drinks" };

function SlideFrame({ href, image, children }: { href: string | null; image: string; children: React.ReactNode }) {
  const body = (
    <>
      <Image src={image} alt="" fill sizes={SIZES} className="kb-hero-slide-photo" draggable={false} />
      <div className="kb-hero-slide-overlay" />
      <div className="kb-hero-slide-body">{children}</div>
    </>
  );
  return href ? (
    <Link href={href} className="kb-hero-slide" draggable={false}>
      {body}
    </Link>
  ) : (
    <div className="kb-hero-slide">{body}</div>
  );
}

export function NewKitchenSlide({ kitchen, image }: { kitchen: Merchant; image: string }) {
  const line = kitchen.blurb.trim() || (kitchen.menuHighlights[0]?.name ? `Popular · ${kitchen.menuHighlights[0].name}` : null);
  return (
    <SlideFrame href={`/merchant/${kitchen.id}`} image={image}>
      <span className="kb-hero-slide-badge is-new">NEW</span>
      <p className="kb-hero-slide-kicker">
        {kitchen.cuisine} · {CATEGORY_LABEL[kitchen.category]}
      </p>
      <h2 className="kb-hero-slide-title">{kitchen.name}</h2>
      {line && <p className="kb-hero-slide-text">{line}</p>}
      <span className="kb-hero-slide-cta">Explore Kitchen →</span>
    </SlideFrame>
  );
}

export function PromotionSlide({ kitchen, deal, image }: { kitchen: Merchant; deal: KitchenDeal; image: string }) {
  const wording = describeDeal(deal);
  if (!wording) return null;
  return (
    <SlideFrame href={dealHref(deal)} image={image}>
      <span className="kb-hero-slide-badge is-deal">🏷️ DEAL</span>
      <p className="kb-hero-slide-kicker">{kitchen.name}</p>
      <h2 className="kb-hero-slide-title">{deal.title || wording.label}</h2>
      {deal.title && <p className="kb-hero-slide-text">{wording.label}</p>}
      <span className="kb-hero-slide-cta">Explore Deal →</span>
    </SlideFrame>
  );
}

export function FlashSlide({ kitchen, deal, image }: { kitchen: Merchant; deal: KitchenDeal; image: string }) {
  const now = useNow(30_000);
  const wording = describeDeal(deal);
  const endsIn = formatEndsIn(deal.endsAt, now);
  if (!wording) return null;
  // Never show an expired deal as available, even if the page has been open a while.
  if (!endsIn)
    return (
      <SlideFrame href={null} image={image}>
        <p className="kb-hero-slide-kicker">{kitchen.name}</p>
        <h2 className="kb-hero-slide-title">This flash deal has ended.</h2>
      </SlideFrame>
    );
  return (
    <SlideFrame href={dealHref(deal)} image={image}>
      <span className="kb-hero-slide-badge is-flash">⚡ FLASH DEAL</span>
      <p className="kb-hero-slide-kicker">{kitchen.name}</p>
      <h2 className="kb-hero-slide-title">{wording.label}</h2>
      <p className="kb-hero-slide-text">{[endsIn, wording.detail].filter(Boolean).join(" · ")}</p>
      <span className="kb-hero-slide-cta">Grab the deal →</span>
    </SlideFrame>
  );
}

/**
 * A designed banner (logo and headline drawn in). It is wider than the hero
 * box, so it is shown whole — never cropped — over a blurred, darkened copy
 * of itself that fills the bands above and below. Same src and sizes, so the
 * browser downloads it once.
 */
export function BrandImageSlide({ src, alt, href }: { src: string; alt: string; href: string | null }) {
  const body = (
    <>
      <Image src={src} alt="" fill sizes={SIZES} className="kb-hero-banner-backdrop" draggable={false} aria-hidden />
      <Image src={src} alt={alt} fill sizes={SIZES} className="kb-hero-banner-image" draggable={false} />
    </>
  );
  return href ? (
    <Link href={href} className="kb-hero-slide kb-hero-banner" draggable={false}>
      {body}
    </Link>
  ) : (
    <div className="kb-hero-slide kb-hero-banner">{body}</div>
  );
}
