import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fixtureCatalog, fixtureCatalogWithUnknownValues } from './__fixtures__/catalog';
import {
  CATALOG_CACHE_TTL_MS,
  CATALOG_STALE_RETRY_MS,
  getCatalog,
  getCatalogDiagnostics,
  getNormalizedCatalog,
  resetCatalogCache,
} from './catalog-cache';

type Deferred = {
  promise: Promise<Response>;
  resolve: (response: Response) => void;
};

function jsonResponse(): Response {
  return new Response(JSON.stringify({ products: fixtureCatalog }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

function createDeferred(): Deferred {
  let resolve: (response: Response) => void = () => {};
  const promise = new Promise<Response>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

const fetchMock = vi.fn<typeof fetch>();

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
  resetCatalogCache();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
  resetCatalogCache();
});

describe('getCatalog', () => {
  it('fetches once and serves later calls inside the ttl from the cache', async () => {
    fetchMock.mockImplementation(async () => jsonResponse());

    const first = await getCatalog();
    const second = await getCatalog();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(second).toBe(first);
  });

  it('refetches once the ttl has expired', async () => {
    vi.useFakeTimers();
    fetchMock.mockImplementation(async () => jsonResponse());

    await getCatalog();
    vi.advanceTimersByTime(CATALOG_CACHE_TTL_MS - 1);
    await getCatalog();
    expect(fetchMock).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(2);
    await getCatalog();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('collapses ten concurrent cold calls into exactly one upstream fetch', async () => {
    const deferred = createDeferred();
    fetchMock.mockImplementation(() => deferred.promise);

    const callers = Array.from({ length: 10 }, () => getCatalog());
    deferred.resolve(jsonResponse());
    const results = await Promise.all(callers);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    for (const result of results) {
      expect(result).toBe(results[0]);
      expect(result).toHaveLength(fixtureCatalog.length);
    }
  });

  it('does not poison the cache with a transient upstream failure', async () => {
    fetchMock.mockRejectedValueOnce(new TypeError('fetch failed'));
    fetchMock.mockRejectedValueOnce(new TypeError('fetch failed'));

    await expect(getCatalog()).rejects.toThrow('fetch failed');

    fetchMock.mockImplementation(async () => jsonResponse());
    const products = await getCatalog();

    expect(products).toHaveLength(fixtureCatalog.length);
  });

  it('lets every concurrent caller see a cold window failure and still recovers afterwards', async () => {
    fetchMock.mockRejectedValue(new TypeError('fetch failed'));

    const callers = Array.from({ length: 5 }, () => getCatalog().catch((error: unknown) => error));
    const failures = await Promise.all(callers);

    expect(fetchMock).toHaveBeenCalledTimes(2);
    for (const failure of failures) {
      expect(failure).toBeInstanceOf(Error);
    }

    fetchMock.mockReset();
    fetchMock.mockImplementation(async () => jsonResponse());
    const products = await getCatalog();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(products).toHaveLength(fixtureCatalog.length);
  });
});

describe('getCatalog when a refresh fails on a warm cache', () => {
  it('serves the last known good catalog instead of failing the request', async () => {
    vi.useFakeTimers();
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    fetchMock.mockImplementation(async () => jsonResponse());

    const warm = await getCatalog();
    vi.advanceTimersByTime(CATALOG_CACHE_TTL_MS + 1);

    fetchMock.mockReset();
    fetchMock.mockRejectedValue(new TypeError('fetch failed'));
    const stale = await getCatalog();

    expect(stale).toBe(warm);
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('last known good'));
    warnSpy.mockRestore();
  });

  it('recovers to fresh data once upstream returns', async () => {
    vi.useFakeTimers();
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    fetchMock.mockImplementation(async () => jsonResponse());

    const warm = await getCatalog();
    vi.advanceTimersByTime(CATALOG_CACHE_TTL_MS + 1);

    fetchMock.mockReset();
    fetchMock.mockRejectedValue(new TypeError('fetch failed'));
    await getCatalog();

    vi.advanceTimersByTime(CATALOG_STALE_RETRY_MS + 1);
    fetchMock.mockReset();
    fetchMock.mockImplementation(async () => jsonResponse());
    const recovered = await getCatalog();

    expect(recovered).not.toBe(warm);
    expect(recovered).toHaveLength(fixtureCatalog.length);
    warnSpy.mockRestore();
  });

  it('still throws when the very first load fails and there is nothing to fall back to', async () => {
    fetchMock.mockRejectedValue(new TypeError('fetch failed'));

    await expect(getCatalog()).rejects.toThrow('fetch failed');
  });
});

describe('getCatalogDiagnostics', () => {
  it('reports a clean load with no unknown values', async () => {
    fetchMock.mockImplementation(async () => jsonResponse());

    const diagnostics = await getCatalogDiagnostics();

    expect(diagnostics.totalReceived).toBe(fixtureCatalog.length);
    expect(diagnostics.validCount).toBe(fixtureCatalog.length);
    expect(diagnostics.unknownValuesByField).toEqual({});
  });

  it('names the unknown values and warns once when the catalog drifts', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    fetchMock.mockImplementation(
      async () =>
        new Response(JSON.stringify({ products: fixtureCatalogWithUnknownValues }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
    );

    const diagnostics = await getCatalogDiagnostics();

    expect(diagnostics.validCount).toBe(fixtureCatalogWithUnknownValues.length);
    expect(diagnostics.unknownValuesByField.category).toEqual(['electronics']);
    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(warnSpy.mock.calls[0][0]).toContain('unknown category values: electronics');
    warnSpy.mockRestore();
  });
});

describe('getNormalizedCatalog', () => {
  it('normalizes every product once per cache load and reuses the same array', async () => {
    fetchMock.mockImplementation(async () => jsonResponse());

    const first = await getNormalizedCatalog();
    const second = await getNormalizedCatalog();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(second).toBe(first);
    expect(first).toHaveLength(fixtureCatalog.length);
    for (const product of first) {
      expect(typeof product.shippingDays).toBe('number');
      expect(typeof product.effectivePrice).toBe('number');
      expect(typeof product.minimumSpend).toBe('number');
    }
  });

  it('shares one upstream fetch with the raw catalog accessor', async () => {
    fetchMock.mockImplementation(async () => jsonResponse());

    const [raw, normalized] = await Promise.all([getCatalog(), getNormalizedCatalog()]);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(normalized).toHaveLength(raw.length);
    expect(normalized[0].id).toBe(raw[0].id);
  });

  it('renormalizes after the ttl expires', async () => {
    vi.useFakeTimers();
    fetchMock.mockImplementation(async () => jsonResponse());

    const first = await getNormalizedCatalog();
    vi.advanceTimersByTime(CATALOG_CACHE_TTL_MS + 1);
    const second = await getNormalizedCatalog();

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(second).not.toBe(first);
  });
});
