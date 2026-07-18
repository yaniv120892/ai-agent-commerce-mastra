import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fixtureCatalog } from './__fixtures__/catalog';
import { CATALOG_CACHE_TTL_MS, getCatalog, resetCatalogCache } from './catalog-cache';

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
