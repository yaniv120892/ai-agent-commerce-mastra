import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fixtureCatalog, fixtureCatalogWithUnknownValues } from './__fixtures__/catalog';
import {
  CATALOG_REQUEST_TIMEOUT_MS,
  CATALOG_URL,
  CatalogPayloadError,
  CatalogRequestError,
  fetchRawProducts,
} from './catalog-client';

function timeoutError(): Error {
  const error = new Error('The operation was aborted due to timeout');
  error.name = 'TimeoutError';
  return error;
}

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
  it('carries an abort signal so a stalled upstream cannot hang the turn', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ products: fixtureCatalog }));

    await fetchRawProducts();

    const requestInit = fetchMock.mock.calls[0][1];
    expect(requestInit?.signal).toBeInstanceOf(AbortSignal);
  });

  it('treats a timeout as retryable and names the elapsed budget', async () => {
    fetchMock.mockRejectedValueOnce(timeoutError());
    fetchMock.mockResolvedValueOnce(jsonResponse({ products: fixtureCatalog }));

    const result = await fetchRawProducts();

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(result.products).toHaveLength(fixtureCatalog.length);
  });

  it('surfaces a timeout that outlives the retry, naming the budget rather than a generic failure', async () => {
    fetchMock.mockRejectedValue(timeoutError());

    const failure = await fetchRawProducts().catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(CatalogRequestError);
    if (!(failure instanceof CatalogRequestError)) {
      throw new Error('expected a CatalogRequestError');
    }
    expect(failure.retryable).toBe(true);
    expect(failure.message).toContain(`timed out after ${CATALOG_REQUEST_TIMEOUT_MS}ms`);
  });

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

    const { products, totalReceived, rejections } = await fetchRawProducts();

    expect(products).toHaveLength(fixtureCatalog.length);
    expect(products[0]).toEqual(fixtureCatalog[0]);
    expect(totalReceived).toBe(fixtureCatalog.length);
    expect(rejections).toEqual([]);
  });

  it('accepts a category outside the frozen slugs rather than failing the whole load', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ products: fixtureCatalogWithUnknownValues }));

    const { products, rejections } = await fetchRawProducts();

    expect(products).toHaveLength(fixtureCatalogWithUnknownValues.length);
    expect(rejections).toEqual([]);
    expect(products.map((product) => product.category)).toContain('electronics');
  });

  it('accepts an unrecognised logistics value rather than failing the whole load', async () => {
    const drifted = [{ ...fixtureCatalog[0], shippingInformation: 'Ships in 4 business days' }];
    fetchMock.mockResolvedValue(jsonResponse({ products: drifted }));

    const { products } = await fetchRawProducts();

    expect(products).toHaveLength(1);
    expect(products[0].shippingInformation).toBe('Ships in 4 business days');
  });

  it('keeps the valid products when a structurally broken one is mixed in', async () => {
    const mixed = [...fixtureCatalog, { id: 'not-a-number', title: 'Broken' }];
    fetchMock.mockResolvedValue(jsonResponse({ products: mixed }));

    const { products, totalReceived, rejections } = await fetchRawProducts();

    expect(products).toHaveLength(fixtureCatalog.length);
    expect(totalReceived).toBe(fixtureCatalog.length + 1);
    expect(rejections).toHaveLength(1);
    expect(rejections[0]).toContain(`index ${fixtureCatalog.length}`);
  });

  it('rejects a payload where most products fail, treating it as a changed API shape', async () => {
    const mostlyBroken = [fixtureCatalog[0], { id: 'x' }, { id: 'y' }, { id: 'z' }];
    fetchMock.mockResolvedValue(jsonResponse({ products: mostlyBroken }));

    const failure = await fetchRawProducts().catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(CatalogPayloadError);
    if (!(failure instanceof CatalogPayloadError)) {
      throw new Error('expected a CatalogPayloadError');
    }
    expect(failure.message).toContain('only 1 valid products out of 4');
  });

  it('rejects a payload whose products are all unparseable', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ products: [{ id: 'nope' }] }));

    await expect(fetchRawProducts()).rejects.toBeInstanceOf(CatalogPayloadError);
  });

  it('accepts an empty catalog without tripping the valid-fraction floor', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ products: [] }));

    const { products, totalReceived } = await fetchRawProducts();

    expect(products).toEqual([]);
    expect(totalReceived).toBe(0);
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

    const { products } = await fetchRawProducts();

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

    const { products } = await fetchRawProducts();

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
