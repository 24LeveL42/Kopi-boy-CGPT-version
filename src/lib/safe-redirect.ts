/**
 * Turns an untrusted redirect target (a ?next= value, a stored link) into a
 * path on this site, or `fallback`. Only a plain relative path is accepted:
 * one leading "/", printable ASCII, and none of the characters that let a
 * browser read it as another host or a script:
 *
 *   "//evil.com", "/\evil.com"  protocol-relative (browsers treat \ as /)
 *   "@"                         `${origin}@evil.com` makes origin the username
 *   ":"                         schemes (https:, javascript:, data:)
 *   whitespace / control chars  stripped or reinterpreted by URL parsers
 *
 * The value is checked as given and after each round of percent-decoding
 * (up to MAX_DECODE_ROUNDS), so encoded and double-encoded forms of the above
 * are caught too. Invalid encoding, or encoding still unwrapping after the
 * last round, also gives the fallback.
 */
const MAX_DECODE_ROUNDS = 5;

/** Printable ASCII except space, "\", "@" and ":". */
const ALLOWED = /^[\x21-\x7e]*$/;
const FORBIDDEN = /[\\@:]/;

function isPlainPath(value: string): boolean {
  return value.startsWith("/") && !value.startsWith("//") && ALLOWED.test(value) && !FORBIDDEN.test(value);
}

export function safeRedirectPath(value: unknown, fallback = "/"): string {
  if (typeof value !== "string" || value === "") return fallback;

  let current = value;
  for (let round = 0; ; round++) {
    if (!isPlainPath(current)) return fallback;
    let decoded: string;
    try {
      decoded = decodeURIComponent(current);
    } catch {
      return fallback;
    }
    if (decoded === current) break;
    if (round >= MAX_DECODE_ROUNDS) return fallback;
    current = decoded;
  }

  // Last line of defence: it must resolve to this same origin.
  try {
    const base = "https://same-origin.invalid";
    if (new URL(value, base).origin !== base) return fallback;
  } catch {
    return fallback;
  }
  return value;
}
