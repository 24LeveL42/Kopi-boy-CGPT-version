/**
 * Postal code -> coordinates via OneMap (Singapore Land Authority).
 *
 * Server-only: import it from Server Actions / Route Handlers, never from a
 * "use client" module, so the OneMap credentials and token never reach a
 * browser bundle. The `server-only` import turns an accidental client import
 * into a build error.
 *
 * Auth: OneMap's search needs a token that expires every 3 days. We get one
 * from getToken with ONEMAP_EMAIL / ONEMAP_PASSWORD, keep it in module memory
 * and refresh it when it is within 12 hours of expiry. A 401 from search gets
 * one fresh token and one retry. If getToken fails or the credentials are not
 * set, ONEMAP_TOKEN (a manually pasted token) is used instead. Logs carry a
 * status or a reason only, never a token, email or password.
 */

import "server-only";

export type GeocodeResult =
  | { ok: true; lat: number; lng: number; address: string }
  | { ok: false; reason: "invalid" | "not_found" | "unavailable" };

const ONEMAP_SEARCH_URL = "https://www.onemap.gov.sg/api/common/elastic/search";
const ONEMAP_TOKEN_URL = "https://www.onemap.gov.sg/api/auth/post/getToken";
const TIMEOUT_MS = 6_000;
const HOUR_MS = 60 * 60 * 1000;
/** Refresh a cached token once it has less than this left. */
const REFRESH_MARGIN_MS = 12 * HOUR_MS;
/** If getToken's expiry can't be read, treat the token as good for this long (OneMap says 3 days). */
const ASSUMED_LIFETIME_MS = 24 * HOUR_MS;
/** After a failed getToken, wait this long before asking again (the fallback is used meanwhile). */
const TOKEN_RETRY_AFTER_MS = 5 * 60 * 1000;

interface OneMapResult {
  POSTAL?: string;
  ADDRESS?: string;
  LATITUDE?: string;
  LONGITUDE?: string;
}

type CachedToken = { token: string; expiresAt: number };

let cached: CachedToken | null = null;
let inFlight: Promise<CachedToken | null> | null = null;
let retryTokenAfter = 0;
let warnedNoCredentials = false;

/** Tests only: forget the cached token and any back-off. */
export function resetOneMapTokenCacheForTests() {
  cached = null;
  inFlight = null;
  retryTokenAfter = 0;
  warnedNoCredentials = false;
}

function errorName(err: unknown) {
  return err instanceof Error ? err.name : "unknown error";
}

/** POST getToken. Resolves null (and logs why) on any failure. */
async function requestToken(): Promise<CachedToken | null> {
  const email = process.env.ONEMAP_EMAIL;
  const password = process.env.ONEMAP_PASSWORD;
  if (!email || !password) {
    if (!warnedNoCredentials) {
      warnedNoCredentials = true;
      console.error("OneMap getToken skipped: ONEMAP_EMAIL / ONEMAP_PASSWORD not set");
    }
    return null;
  }

  try {
    const res = await fetch(ONEMAP_TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
      cache: "no-store",
    });
    if (!res.ok) {
      console.error("OneMap getToken failed: HTTP", res.status);
      return null;
    }
    const body = (await res.json().catch(() => null)) as { access_token?: unknown; expiry_timestamp?: unknown } | null;
    const token = body?.access_token;
    if (typeof token !== "string" || token === "") {
      console.error("OneMap getToken failed: no access_token in response");
      return null;
    }
    // expiry_timestamp is Unix seconds (string or number).
    const expirySeconds = Number(body?.expiry_timestamp);
    const now = Date.now();
    const expiresAt = Number.isFinite(expirySeconds) && expirySeconds * 1000 > now ? expirySeconds * 1000 : now + ASSUMED_LIFETIME_MS;
    return { token, expiresAt };
  } catch (err) {
    console.error("OneMap getToken failed:", errorName(err));
    return null;
  }
}

/**
 * The token to send. `force` skips the cache (after a 401). Concurrent callers
 * share one getToken request. Falls back to ONEMAP_TOKEN, then to no token.
 */
async function oneMapToken(force = false): Promise<string | null> {
  const now = Date.now();
  if (!force && cached && cached.expiresAt - now > REFRESH_MARGIN_MS) return cached.token;
  if (force) cached = null;

  if (now >= retryTokenAfter) {
    if (!inFlight) {
      inFlight = requestToken().then((fresh) => {
        if (fresh) cached = fresh;
        else retryTokenAfter = Date.now() + TOKEN_RETRY_AFTER_MS;
        return fresh;
      });
      inFlight.finally(() => (inFlight = null)).catch(() => {});
    }
    const fresh = await inFlight;
    if (fresh) return fresh.token;
  }

  // getToken failed: a cached token that hasn't expired yet beats the fallback.
  if (cached && cached.expiresAt > Date.now()) return cached.token;
  return process.env.ONEMAP_TOKEN || null;
}

async function search(url: string, token: string | null) {
  return fetch(url, {
    // OneMap takes the bare token in Authorization, no "Bearer " prefix.
    headers: token ? { Authorization: token } : undefined,
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
}

export async function geocodePostalCode(postal: string): Promise<GeocodeResult> {
  const code = postal.trim();
  if (!/^\d{6}$/.test(code)) return { ok: false, reason: "invalid" };

  const url = `${ONEMAP_SEARCH_URL}?searchVal=${code}&returnGeom=Y&getAddrDetails=Y&pageNum=1`;

  let results: OneMapResult[];
  try {
    const token = await oneMapToken();
    let res = await search(url, token);
    if (res.status === 401) {
      const fresh = await oneMapToken(true);
      if (!fresh || fresh === token) {
        console.error("OneMap search failed: HTTP 401, no fresh token to retry with");
        return { ok: false, reason: "unavailable" };
      }
      res = await search(url, fresh);
    }
    // Judge only by `results`: OneMap has answered with results alongside an
    // error field before.
    const body = (await res.json().catch(() => null)) as { results?: unknown } | null;
    if (!Array.isArray(body?.results)) {
      console.error("OneMap search failed: HTTP", res.status);
      return { ok: false, reason: "unavailable" };
    }
    results = body.results as OneMapResult[];
  } catch (err) {
    console.error("OneMap search failed:", errorName(err));
    return { ok: false, reason: "unavailable" };
  }

  for (const r of results) {
    if (r.POSTAL !== code) continue;
    const lat = Number(r.LATITUDE);
    const lng = Number(r.LONGITUDE);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;
    return { ok: true, lat, lng, address: r.ADDRESS ?? code };
  }
  return { ok: false, reason: "not_found" };
}
