/**
 * The one place the brand's name lives. Every customer-facing "Kopi Boy"
 * (page titles, alt text, help copy, the manifest) is built from these, so a
 * rename is a change here. Not covered yet: the logo artwork in public/brand;
 * public/sw.js (a plain service worker that can't import this; its fallback
 * notification title is only used when a push arrives without one); and the
 * cart (CartView) and Payment method page, left alone until checkout work
 * next touches them.
 */
export const BRAND_NAME = "Kopi Boy";

/** How HQ signs support replies and chat messages. */
export const BRAND_SUPPORT_NAME = `${BRAND_NAME} Support`;
