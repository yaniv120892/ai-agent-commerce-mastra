import { fetchRawProducts } from './catalog-client';
import { normalizeProduct } from './normalize';
import type { NormalizedProduct, RawProduct } from './types';

type CacheEntry = {
  products: RawProduct[];
  normalizedProducts: NormalizedProduct[];
  expiresAt: number;
};

export const CATALOG_CACHE_TTL_MS = 5 * 60 * 1000;

let cacheEntry: CacheEntry | null = null;
let inFlightLoad: Promise<CacheEntry> | null = null;

export async function getCatalog(): Promise<RawProduct[]> {
  const entry = await getCacheEntry();

  return entry.products;
}

export async function getNormalizedCatalog(): Promise<NormalizedProduct[]> {
  const entry = await getCacheEntry();

  return entry.normalizedProducts;
}

export function resetCatalogCache(): void {
  cacheEntry = null;
  inFlightLoad = null;
}

async function getCacheEntry(): Promise<CacheEntry> {
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

async function loadCatalog(): Promise<CacheEntry> {
  const products = await fetchRawProducts();
  const entry: CacheEntry = {
    products,
    normalizedProducts: products.map((product) => normalizeProduct(product)),
    expiresAt: Date.now() + CATALOG_CACHE_TTL_MS,
  };
  cacheEntry = entry;

  return entry;
}

function readFreshEntry(): CacheEntry | null {
  if (!cacheEntry) {
    return null;
  }
  if (cacheEntry.expiresAt <= Date.now()) {
    cacheEntry = null;
    return null;
  }

  return cacheEntry;
}
