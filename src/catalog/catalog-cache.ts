import { fetchRawProducts, type CatalogParseResult } from './catalog-client';
import { collectUnknownValues, normalizeProduct } from './normalize';
import type { CatalogDiagnostics, NormalizedProduct, RawProduct } from './types';

type CacheEntry = {
  products: RawProduct[];
  normalizedProducts: NormalizedProduct[];
  diagnostics: CatalogDiagnostics;
  expiresAt: number;
};

export const CATALOG_CACHE_TTL_MS = 5 * 60 * 1000;

// A stale entry is served on a short retry window rather than the full TTL, so recovery
// tracks upstream coming back instead of waiting out another five minutes.
export const CATALOG_STALE_RETRY_MS = 30 * 1000;

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

export async function getCatalogDiagnostics(): Promise<CatalogDiagnostics> {
  const entry = await getCacheEntry();

  return entry.diagnostics;
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
  const lastKnownGood = cacheEntry;

  let parseResult: CatalogParseResult;
  try {
    parseResult = await fetchRawProducts();
  } catch (error) {
    if (!lastKnownGood) {
      throw error;
    }
    return reviveStaleEntry(lastKnownGood, error);
  }

  const { products, totalReceived, rejections } = parseResult;
  const diagnostics: CatalogDiagnostics = {
    totalReceived,
    validCount: products.length,
    unknownValuesByField: collectUnknownValues(products),
  };
  const entry: CacheEntry = {
    products,
    normalizedProducts: products.map((product) => normalizeProduct(product)),
    diagnostics,
    expiresAt: Date.now() + CATALOG_CACHE_TTL_MS,
  };
  cacheEntry = entry;
  warnOnDegradedLoad(diagnostics, rejections);

  return entry;
}

function reviveStaleEntry(lastKnownGood: CacheEntry, error: unknown): CacheEntry {
  console.warn(
    `[catalog] refresh failed, serving the last known good catalog ` +
      `(${lastKnownGood.products.length} products): ${describeError(error)}`,
  );
  const revived: CacheEntry = { ...lastKnownGood, expiresAt: Date.now() + CATALOG_STALE_RETRY_MS };
  cacheEntry = revived;

  return revived;
}

function warnOnDegradedLoad(diagnostics: CatalogDiagnostics, rejections: string[]): void {
  const skippedCount = diagnostics.totalReceived - diagnostics.validCount;
  const unknownFields = Object.entries(diagnostics.unknownValuesByField);
  if (skippedCount === 0 && unknownFields.length === 0) {
    return;
  }

  const lines = [
    `[catalog] loaded ${diagnostics.validCount}/${diagnostics.totalReceived} products`,
  ];
  if (skippedCount > 0) {
    lines.push(`  skipped ${skippedCount} (validation): ${rejections.join('; ')}`);
  }
  for (const [fieldName, values] of unknownFields) {
    lines.push(`  unknown ${fieldName} values: ${values.join(', ')}`);
  }
  console.warn(lines.join('\n'));
}

// Deliberately does not clear an expired entry: loadCatalog needs it as the last known
// good fallback when the refresh that replaces it fails.
function readFreshEntry(): CacheEntry | null {
  if (!cacheEntry) {
    return null;
  }
  if (cacheEntry.expiresAt <= Date.now()) {
    return null;
  }

  return cacheEntry;
}

function describeError(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}
