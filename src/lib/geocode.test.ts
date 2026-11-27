import { afterEach, beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { geocodePostalCode, resetOneMapTokenCacheForTests } from "./geocode.ts";

const realFetch = globalThis.fetch;

function mockFetch(impl: (url: string, init?: RequestInit) => Promise<Response>) {
  const calls: { url: string; init?: RequestInit }[] = [];
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, init });
    return impl(url, init);
  }) as typeof fetch;
  return calls;
}

function json(body: unknown, status = 200) {
  return Promise.resolve(new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } }));
}

const TOA_PAYOH = {
  SEARCHVAL: "BLK 123",
  POSTAL: "310123",
  ADDRESS: "123 LORONG 1 TOA PAYOH SINGAPORE 310123",
  LATITUDE: "1.33722605245",
  LONGITUDE: "103.84557263523",
};

const realError = console.error;
const realNow = Date.now;
let logged: string[] = [];

beforeEach(() => {
  resetOneMapTokenCacheForTests();
  logged = [];
  console.error = (...args: unknown[]) => void logged.push(args.map(String).join(" "));
});

afterEach(() => {
  globalThis.fetch = realFetch;
  console.error = realError;
  Date.now = realNow;
  delete process.env.ONEMAP_TOKEN;
  delete process.env.ONEMAP_EMAIL;
  delete process.env.ONEMAP_PASSWORD;
});

describe("geocodePostalCode", () => {
  it("rejects anything that isn't exactly 6 digits without calling OneMap", async () => {
    const calls = mockFetch(() => json({ results: [] }));
    for (const bad of ["", "31012", "3101234", "31012a", "310 123"]) {
      assert.deepEqual(await geocodePostalCode(bad), { ok: false, reason: "invalid" });
    }
    assert.equal(calls.length, 0);
  });

  it("returns the result whose POSTAL matches, with numeric coordinates", async () => {
    const calls = mockFetch(() =>
      json({
        found: 2,
        results: [{ ...TOA_PAYOH, POSTAL: "310124", LATITUDE: "9", LONGITUDE: "9" }, TOA_PAYOH],
      })
    );
    const result = await geocodePostalCode("310123");
    assert.deepEqual(result, {
      ok: true,
      lat: 1.33722605245,
      lng: 103.84557263523,
      address: TOA_PAYOH.ADDRESS,
    });
    assert.equal(calls.length, 1);
    const url = new URL(calls[0].url);
    assert.equal(url.origin + url.pathname, "https://www.onemap.gov.sg/api/common/elastic/search");
    assert.equal(url.searchParams.get("searchVal"), "310123");
    assert.equal(url.searchParams.get("returnGeom"), "Y");
    assert.equal(url.searchParams.get("getAddrDetails"), "Y");
    assert.equal(url.searchParams.get("pageNum"), "1");
    assert.ok(calls[0].init?.signal, "request should carry a timeout signal");
  });

  it("returns not_found when no result has the exact postal code", async () => {
    mockFetch(() => json({ found: 1, results: [{ ...TOA_PAYOH, POSTAL: "310124" }] }));
    assert.deepEqual(await geocodePostalCode("310123"), { ok: false, reason: "not_found" });
  });

  it("returns not_found for an empty result list", async () => {
    mockFetch(() => json({ found: 0, results: [] }));
    assert.deepEqual(await geocodePostalCode("999999"), { ok: false, reason: "not_found" });
  });

  it("returns unavailable on a network error", async () => {
    mockFetch(() => Promise.reject(new TypeError("fetch failed")));
    assert.deepEqual(await geocodePostalCode("310123"), { ok: false, reason: "unavailable" });
  });

  it("returns unavailable on a timeout", async () => {
    mockFetch(() => Promise.reject(new DOMException("The operation was aborted due to timeout", "TimeoutError")));
    assert.deepEqual(await geocodePostalCode("310123"), { ok: false, reason: "unavailable" });
  });

  it("returns unavailable on a server error with no results", async () => {
    mockFetch(() => json({ error: "Internal error" }, 500));
    assert.deepEqual(await geocodePostalCode("310123"), { ok: false, reason: "unavailable" });
  });

  it("ignores OneMap's 'token missing' error field and judges by results", async () => {
    const calls = mockFetch(() => json({ error: "Token missing", found: 1, results: [TOA_PAYOH] }));
    const result = await geocodePostalCode("310123");
    assert.equal(result.ok, true);
    assert.equal(new Headers(calls[0].init?.headers).get("authorization"), null);
  });

  it("sends ONEMAP_TOKEN as the Authorization header when set", async () => {
    process.env.ONEMAP_TOKEN = "test-token";
    const calls = mockFetch(() => json({ results: [TOA_PAYOH] }));
    await geocodePostalCode("310123");
    assert.equal(new Headers(calls[0].init?.headers).get("authorization"), "test-token");
  });
});

// ---------------------------------------------------------------- token auth

const TOKEN_URL = "https://www.onemap.gov.sg/api/auth/post/getToken";
const SECRETS = ["ops@example.test", "s3cret-pass", "fresh-1", "fresh-2", "env-token", "stale-token"];
const HOUR = 60 * 60 * 1000;

function withCredentials() {
  process.env.ONEMAP_EMAIL = "ops@example.test";
  process.env.ONEMAP_PASSWORD = "s3cret-pass";
}

/** Routes getToken and search; `searchFor(token)` decides the search reply. */
function oneMap(opts: {
  tokens?: (() => Promise<Response>)[];
  searchFor?: (token: string | null) => Promise<Response>;
}) {
  const tokens = [...(opts.tokens ?? [])];
  const searchFor = opts.searchFor ?? (() => json({ results: [TOA_PAYOH] }));
  const calls = mockFetch((url, init) => {
    if (url === TOKEN_URL) {
      const next = tokens.shift();
      return next ? next() : json({ error: "no more tokens" }, 500);
    }
    return searchFor(new Headers(init?.headers).get("authorization"));
  });
  return {
    calls,
    tokenCalls: () => calls.filter((c) => c.url === TOKEN_URL),
    searchTokens: () => calls.filter((c) => c.url !== TOKEN_URL).map((c) => new Headers(c.init?.headers).get("authorization")),
  };
}

const token = (access_token: string, expiresInMs = 72 * HOUR) => () =>
  json({ access_token, expiry_timestamp: String(Math.floor((Date.now() + expiresInMs) / 1000)) });

function assertNoSecretsLogged() {
  for (const line of logged) for (const secret of SECRETS) assert.ok(!line.includes(secret), `log leaked a secret: ${line}`);
}

describe("geocodePostalCode — OneMap token", () => {
  it("gets a token with ONEMAP_EMAIL / ONEMAP_PASSWORD and sends it raw in Authorization", async () => {
    withCredentials();
    const m = oneMap({ tokens: [token("fresh-1")] });

    assert.equal((await geocodePostalCode("310123")).ok, true);

    const [call] = m.tokenCalls();
    assert.equal(call.init?.method, "POST");
    assert.equal(new Headers(call.init?.headers).get("content-type"), "application/json");
    assert.deepEqual(JSON.parse(String(call.init?.body)), { email: "ops@example.test", password: "s3cret-pass" });
    assert.deepEqual(m.searchTokens(), ["fresh-1"]);
  });

  it("reuses the cached token while it has more than 12 hours left", async () => {
    withCredentials();
    const m = oneMap({ tokens: [token("fresh-1"), token("fresh-2")] });

    await geocodePostalCode("310123");
    const start = Date.now();
    Date.now = () => start + 59 * HOUR; // 13 h left of 72
    await geocodePostalCode("310123");

    assert.equal(m.tokenCalls().length, 1);
    assert.deepEqual(m.searchTokens(), ["fresh-1", "fresh-1"]);
  });

  it("refreshes once the token is within 12 hours of expiry", async () => {
    withCredentials();
    const m = oneMap({ tokens: [token("fresh-1"), token("fresh-2")] });

    await geocodePostalCode("310123");
    const start = Date.now();
    Date.now = () => start + 61 * HOUR; // 11 h left of 72
    await geocodePostalCode("310123");

    assert.equal(m.tokenCalls().length, 2);
    assert.deepEqual(m.searchTokens(), ["fresh-1", "fresh-2"]);
  });

  it("shares one getToken request between concurrent lookups", async () => {
    withCredentials();
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const m = oneMap({ tokens: [() => gate.then(token("fresh-1"))] });

    const lookups = Promise.all([geocodePostalCode("310123"), geocodePostalCode("310123"), geocodePostalCode("310123")]);
    await new Promise((r) => setTimeout(r, 0));
    release();
    const results = await lookups;

    assert.ok(results.every((r) => r.ok));
    assert.equal(m.tokenCalls().length, 1);
    assert.deepEqual(m.searchTokens(), ["fresh-1", "fresh-1", "fresh-1"]);
  });

  it("on a 401 gets a fresh token and retries once", async () => {
    withCredentials();
    const m = oneMap({
      tokens: [token("fresh-1"), token("fresh-2")],
      searchFor: (t) => (t === "fresh-2" ? json({ results: [TOA_PAYOH] }) : json({ error: "Unauthorized" }, 401)),
    });

    assert.equal((await geocodePostalCode("310123")).ok, true);
    assert.equal(m.tokenCalls().length, 2);
    assert.deepEqual(m.searchTokens(), ["fresh-1", "fresh-2"]);
  });

  it("retries a 401 only once, then reports unavailable", async () => {
    withCredentials();
    const m = oneMap({ tokens: [token("fresh-1"), token("fresh-2")], searchFor: () => json({ error: "Unauthorized" }, 401) });

    assert.deepEqual(await geocodePostalCode("310123"), { ok: false, reason: "unavailable" });
    assert.deepEqual(m.searchTokens(), ["fresh-1", "fresh-2"]);
    assert.ok(logged.some((l) => l.includes("401")));
    assertNoSecretsLogged();
  });

  it("does not retry a 401 with the same token when no fresh one can be had", async () => {
    process.env.ONEMAP_TOKEN = "stale-token"; // no credentials
    const m = oneMap({ searchFor: () => json({ error: "Unauthorized" }, 401) });

    assert.deepEqual(await geocodePostalCode("310123"), { ok: false, reason: "unavailable" });
    assert.deepEqual(m.searchTokens(), ["stale-token"]);
    assertNoSecretsLogged();
  });

  it("falls back to ONEMAP_TOKEN when the credentials are missing", async () => {
    process.env.ONEMAP_TOKEN = "env-token";
    const m = oneMap({});

    assert.equal((await geocodePostalCode("310123")).ok, true);
    assert.equal(m.tokenCalls().length, 0);
    assert.deepEqual(m.searchTokens(), ["env-token"]);
    assertNoSecretsLogged();
  });

  for (const [name, reply] of [
    ["an HTTP error", () => json({ error: "bad credentials" }, 401)],
    ["a response with no access_token", () => json({ message: "ok" })],
    ["a network error", () => Promise.reject(new TypeError("fetch failed"))],
  ] as const) {
    it(`falls back to ONEMAP_TOKEN when getToken fails with ${name}, and logs no secrets`, async () => {
      withCredentials();
      process.env.ONEMAP_TOKEN = "env-token";
      const m = oneMap({ tokens: [reply] });

      assert.equal((await geocodePostalCode("310123")).ok, true);
      assert.deepEqual(m.searchTokens(), ["env-token"]);
      assert.ok(logged.some((l) => l.startsWith("OneMap getToken failed")));
      assertNoSecretsLogged();
    });
  }

  it("waits 5 minutes before asking getToken again after it failed", async () => {
    withCredentials();
    process.env.ONEMAP_TOKEN = "env-token";
    const m = oneMap({ tokens: [() => json({}, 500), token("fresh-1")] });

    const start = Date.now();
    await geocodePostalCode("310123");
    await geocodePostalCode("310123");
    assert.equal(m.tokenCalls().length, 1);

    Date.now = () => start + 4 * 60 * 1000 + 59 * 1000; // 4 min 59 s: still waiting
    await geocodePostalCode("310123");
    assert.equal(m.tokenCalls().length, 1);

    Date.now = () => start + 5 * 60 * 1000 + 1000; // 5 min 1 s: asks again
    await geocodePostalCode("310123");
    assert.equal(m.tokenCalls().length, 2);
    assert.deepEqual(m.searchTokens(), ["env-token", "env-token", "env-token", "fresh-1"]);
  });

  it("treats a token with an unreadable expiry as good for a day", async () => {
    withCredentials();
    const m = oneMap({ tokens: [() => json({ access_token: "fresh-1" }), token("fresh-2")] });

    await geocodePostalCode("310123");
    const start = Date.now();
    Date.now = () => start + 11 * HOUR; // 13 h left of an assumed 24
    await geocodePostalCode("310123");
    assert.equal(m.tokenCalls().length, 1);
    Date.now = () => start + 13 * HOUR; // 11 h left
    await geocodePostalCode("310123");
    assert.equal(m.tokenCalls().length, 2);
  });

  it("logs only a status for a failed search", async () => {
    withCredentials();
    oneMap({ tokens: [token("fresh-1")], searchFor: () => json({ error: "boom" }, 503) });

    assert.deepEqual(await geocodePostalCode("310123"), { ok: false, reason: "unavailable" });
    assert.deepEqual(logged, ["OneMap search failed: HTTP 503"]);
  });
});
