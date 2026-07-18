import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fixtureCatalog } from './__fixtures__/catalog';
import {
  CATALOG_URL,
  CatalogPayloadError,
  CatalogRequestError,
  fetchRawProducts,
} from './catalog-client';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function errorResponse(status: number, statusText: string): Response {
  return new Response('upstream failure', { status, statusText });
}

const fetchMock = vi.fn<typeof fetch>();

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('fetchRawProducts', () => {
  it('requests the hardcoded dummyjson catalog url with limit 0 and the selected fields', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ products: fixtureCatalog }));

    await fetchRawProducts();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const requestedUrl = fetchMock.mock.calls[0][0];
    expect(requestedUrl).toBe(CATALOG_URL);
    expect(requestedUrl).toContain('https://dummyjson.com/products?limit=0&select=');
    expect(requestedUrl).toContain('minimumOrderQuantity');
    expect(requestedUrl).toContain('warrantyInformation');
  });

  it('returns every validated product from the payload', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ products: fixtureCatalog }));

    const products = await fetchRawProducts();

    expect(products).toHaveLength(fixtureCatalog.length);
    expect(products[0]).toEqual(fixtureCatalog[0]);
  });

  it('rejects a payload whose category is outside the frozen enum, naming the offending value', async () => {
    const malformed = [{ ...fixtureCatalog[0], category: 'electronics' }];
    fetchMock.mockResolvedValue(jsonResponse({ products: malformed }));

    const failure = await fetchRawProducts().catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(CatalogPayloadError);
    if (!(failure instanceof CatalogPayloadError)) {
      throw new Error('expected a CatalogPayloadError');
    }
    expect(failure.message).toContain('index 0');
    expect(failure.message).toContain('category');
    expect(failure.receivedPayload).toContain('electronics');
  });

  it('rejects a payload whose shipping information is an unrecognised logistics value', async () => {
    const malformed = [{ ...fixtureCatalog[0], shippingInformation: 'Ships in 4 business days' }];
    fetchMock.mockResolvedValue(jsonResponse({ products: malformed }));

    await expect(fetchRawProducts()).rejects.toBeInstanceOf(CatalogPayloadError);
  });

  it('rejects a payload that is not a products envelope', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ items: [] }));

    const failure = await fetchRawProducts().catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(CatalogPayloadError);
    if (!(failure instanceof CatalogPayloadError)) {
      throw new Error('expected a CatalogPayloadError');
    }
    expect(failure.message).toContain('products');
  });

  it('rejects a body that is not valid json without retrying', async () => {
    fetchMock.mockResolvedValue(new Response('<html>maintenance</html>', { status: 200 }));

    await expect(fetchRawProducts()).rejects.toBeInstanceOf(CatalogPayloadError);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('retries once on a 5xx and succeeds on the second attempt', async () => {
    fetchMock
      .mockResolvedValueOnce(errorResponse(503, 'Service Unavailable'))
      .mockResolvedValueOnce(jsonResponse({ products: fixtureCatalog }));

    const products = await fetchRawProducts();

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(products).toHaveLength(fixtureCatalog.length);
  });

  it('retries a 5xx exactly once and then surfaces the status', async () => {
    fetchMock.mockResolvedValue(errorResponse(500, 'Internal Server Error'));

    const failure = await fetchRawProducts().catch((error: unknown) => error);

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(failure).toBeInstanceOf(CatalogRequestError);
    if (!(failure instanceof CatalogRequestError)) {
      throw new Error('expected a CatalogRequestError');
    }
    expect(failure.status).toBe(500);
    expect(failure.message).toContain('500');
  });

  it('does not retry a 4xx', async () => {
    fetchMock.mockResolvedValue(errorResponse(404, 'Not Found'));

    const failure = await fetchRawProducts().catch((error: unknown) => error);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(failure).toBeInstanceOf(CatalogRequestError);
    if (!(failure instanceof CatalogRequestError)) {
      throw new Error('expected a CatalogRequestError');
    }
    expect(failure.status).toBe(404);
    expect(failure.retryable).toBe(false);
  });

  it('retries once on a network level failure', async () => {
    fetchMock
      .mockRejectedValueOnce(new TypeError('fetch failed'))
      .mockResolvedValueOnce(jsonResponse({ products: fixtureCatalog }));

    const products = await fetchRawProducts();

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(products).toHaveLength(fixtureCatalog.length);
  });

  it('surfaces the underlying cause when both network attempts fail', async () => {
    fetchMock.mockRejectedValue(new TypeError('fetch failed'));

    const failure = await fetchRawProducts().catch((error: unknown) => error);

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(failure).toBeInstanceOf(CatalogRequestError);
    if (!(failure instanceof CatalogRequestError)) {
      throw new Error('expected a CatalogRequestError');
    }
    expect(failure.message).toContain('fetch failed');
  });
});
