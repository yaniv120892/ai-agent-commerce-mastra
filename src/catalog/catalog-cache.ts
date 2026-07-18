import { fetchRawProducts } from './catalog-client';
import type { RawProduct } from './types';

type CacheEntry = {
  products: RawProduct[];
  expiresAt: number;
};

export const CATALOG_CACHE_TTL_MS = 5 * 60 * 1000;

let cacheEntry: CacheEntry | null = null;
let inFlightLoad: Promise<RawProduct[]> | null = null;

export async function getCatalog(): Promise<RawProduct[]> {
  const fresh = readFreshEntry();
  if (fresh) {
    return fresh;
  }

  if (inFlightLoad) {
    return inFlightLoad;
  }

  inFlightLoad = loadCatalog();
  try {
    return await inFlightLoad;
  } finally {
    inFlightLoad = null;
  }
}

export function resetCatalogCache(): void {
  cacheEntry = null;
  inFlightLoad = null;
}

async function loadCatalog(): Promise<RawProduct[]> {
  const products = await fetchRawProducts();
  cacheEntry = { products, expiresAt: Date.now() + CATALOG_CACHE_TTL_MS };
  return products;
}

function readFreshEntry(): RawProduct[] | null {
  if (!cacheEntry) {
    return null;
  }
  if (cacheEntry.expiresAt <= Date.now()) {
    cacheEntry = null;
    return null;
  }
  return cacheEntry.products;
}
