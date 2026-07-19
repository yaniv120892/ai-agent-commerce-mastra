import type {
  NormalizedProduct,
  ProductCard,
  RetrievalCriteria,
  RetrievalResult,
  SortOption,
} from './types';

type ScoredProduct = {
  product: NormalizedProduct;
  score: number;
};

type ProductTokens = {
  title: string[];
  tags: string[];
  description: string[];
  brand: string[];
};

const MAX_RESULTS = 6;
const SHORT_DESCRIPTION_MAX_LENGTH = 140;

const TITLE_WEIGHT = 10;
const TAGS_WEIGHT = 6;
const BRAND_WEIGHT = 4;
const DESCRIPTION_WEIGHT = 2;

const EXACT_TITLE_SCORE = 1000;
const EXACT_MATCH_QUALITY = 1;
const PARTIAL_MATCH_QUALITY = 0.5;
const MINIMUM_PARTIAL_MATCH_LENGTH = 4;
const COVERAGE_FLOOR = 0.25;

// The counts exist because `products` is capped at MAX_RESULTS, and a caller holding only
// a capped list cannot tell "this is everything" from "this is the first six of many". The
// two category counts answer the questions a categorySlug makes unanswerable: how much the
// filter hid, and how large the category is regardless of search terms.
// remainingAfterThisPage answers the one totalMatched invites a caller to get wrong: on a
// second page the cards on screen are themselves inside totalMatched, so the remainder is
// stated here rather than left as a subtraction for the caller to perform.
export function resolveProductsWithTotals(
  criteria: RetrievalCriteria,
  catalog: NormalizedProduct[],
): RetrievalResult {
  const retained = selectMatching(criteria, catalog);
  const products = retained.slice(0, MAX_RESULTS).map((entry) => toProductCard(entry.product));

  return {
    products,
    totalMatched: retained.length,
    remainingAfterThisPage: retained.length - products.length,
    totalMatchedWithoutCategoryFilter: countMatchedWithoutCategoryFilter(criteria, catalog),
    totalInCategory: countInCategory(criteria, catalog),
  };
}

export function resolveProducts(
  criteria: RetrievalCriteria,
  catalog: NormalizedProduct[],
): ProductCard[] {
  return resolveProductsWithTotals(criteria, catalog).products;
}

function selectMatching(
  criteria: RetrievalCriteria,
  catalog: NormalizedProduct[],
): ScoredProduct[] {
  const bounded = withoutMeaninglessUpperBounds(criteria);
  const searchTerms = normalizeSearchTerms(bounded.searchTerms);
  const eligible = catalog.filter((product) => passesHardFilters(product, bounded));
  const scored = scoreProducts(eligible, searchTerms);
  const sorted = sortScoredProducts(scored, criteria.sort ?? 'relevance');

  return sorted.filter((entry) => !isExcluded(entry.product, criteria));
}

// A zero upper bound is never a real shopper constraint — nobody asks for products costing
// at most nothing, or shipping in at most zero days — but a model repairing a rejected call
// reaches for zero as a neutral placeholder, and left alone it eliminates the whole catalog.
// Only the upper bounds are treated this way: a zero *lower* bound (minPrice, minRating,
// minReturnDays) is already a harmless no-op, and blanket-stripping every zero would throw
// away real filters alongside the placeholders.
function withoutMeaninglessUpperBounds(criteria: RetrievalCriteria): RetrievalCriteria {
  const bounded = { ...criteria };
  if (bounded.maxPrice === 0) {
    delete bounded.maxPrice;
  }
  if (bounded.maxShippingDays === 0) {
    delete bounded.maxShippingDays;
  }

  return bounded;
}

function countMatchedWithoutCategoryFilter(
  criteria: RetrievalCriteria,
  catalog: NormalizedProduct[],
): number | undefined {
  if (criteria.categorySlug === undefined) {
    return undefined;
  }

  return selectMatching({ ...criteria, categorySlug: undefined }, catalog).length;
}

// Deliberately ignores searchTerms and every other filter: this answers "how many of these
// do you stock", where a term that failed to score is not evidence of absent inventory.
function countInCategory(
  criteria: RetrievalCriteria,
  catalog: NormalizedProduct[],
): number | undefined {
  const { categorySlug } = criteria;
  if (categorySlug === undefined) {
    return undefined;
  }

  return catalog.filter((product) => product.category === categorySlug).length;
}

function passesHardFilters(product: NormalizedProduct, criteria: RetrievalCriteria): boolean {
  if (criteria.categorySlug !== undefined && product.category !== criteria.categorySlug) {
    return false;
  }
  if (criteria.maxPrice !== undefined && product.price > criteria.maxPrice) {
    return false;
  }
  if (criteria.minPrice !== undefined && product.price < criteria.minPrice) {
    return false;
  }
  if (criteria.minRating !== undefined && product.rating < criteria.minRating) {
    return false;
  }
  if (criteria.inStock === true && product.availabilityStatus === 'Out of Stock') {
    return false;
  }
  if (!satisfiesMaxShippingDays(product.shippingDays, criteria.maxShippingDays)) {
    return false;
  }
  if (!satisfiesMinReturnDays(product.returnDays, criteria.minReturnDays)) {
    return false;
  }

  return true;
}

// An unnormalized logistics value cannot be shown to satisfy the filter, so it is excluded
// while the filter is active. Without the explicit undefined check the comparison would be
// `undefined > n` — false — and the product would silently pass a bound it never met.
function satisfiesMaxShippingDays(
  shippingDays: number | undefined,
  maxShippingDays: number | undefined,
): boolean {
  if (maxShippingDays === undefined) {
    return true;
  }
  if (shippingDays === undefined) {
    return false;
  }
  return shippingDays <= maxShippingDays;
}

function satisfiesMinReturnDays(
  returnDays: number | undefined,
  minReturnDays: number | undefined,
): boolean {
  if (minReturnDays === undefined) {
    return true;
  }
  if (returnDays === undefined) {
    return false;
  }
  return returnDays >= minReturnDays;
}

function scoreProducts(products: NormalizedProduct[], searchTerms: string[]): ScoredProduct[] {
  if (searchTerms.length === 0) {
    return products.map((product) => ({ product, score: 0 }));
  }

  const scored: ScoredProduct[] = [];
  for (const product of products) {
    const score = scoreProduct(product, searchTerms);
    if (score > 0) {
      scored.push({ product, score });
    }
  }

  return scored;
}

function scoreProduct(product: NormalizedProduct, searchTerms: string[]): number {
  const tokens = tokenizeProduct(product);
  if (tokens.title.join(' ') === searchTerms.join(' ')) {
    return EXACT_TITLE_SCORE;
  }

  let total = 0;
  let matchedTerms = 0;
  for (const term of searchTerms) {
    const termScore = scoreTerm(term, tokens);
    if (termScore > 0) {
      matchedTerms += 1;
      total += termScore;
    }
  }

  if (matchedTerms === 0) {
    return 0;
  }

  const coverage = matchedTerms / searchTerms.length;

  return total * (COVERAGE_FLOOR + (1 - COVERAGE_FLOOR) * coverage);
}

function scoreTerm(term: string, tokens: ProductTokens): number {
  return (
    TITLE_WEIGHT * matchQuality(term, tokens.title) +
    TAGS_WEIGHT * matchQuality(term, tokens.tags) +
    BRAND_WEIGHT * matchQuality(term, tokens.brand) +
    DESCRIPTION_WEIGHT * matchQuality(term, tokens.description)
  );
}

function matchQuality(term: string, fieldTokens: string[]): number {
  let best = 0;
  for (const token of fieldTokens) {
    if (token === term) {
      return EXACT_MATCH_QUALITY;
    }
    if (isPartialMatch(term, token)) {
      best = PARTIAL_MATCH_QUALITY;
    }
  }

  return best;
}

function isPartialMatch(term: string, token: string): boolean {
  const bothLongEnough =
    term.length >= MINIMUM_PARTIAL_MATCH_LENGTH && token.length >= MINIMUM_PARTIAL_MATCH_LENGTH;
  if (!bothLongEnough) {
    return false;
  }

  return token.includes(term) || term.includes(token);
}

function sortScoredProducts(scored: ScoredProduct[], sort: SortOption): ScoredProduct[] {
  return [...scored].sort((left, right) => {
    const primary = compareBySortOption(sort, left, right);
    if (primary !== 0) {
      return primary;
    }

    return left.product.id - right.product.id;
  });
}

function compareBySortOption(sort: SortOption, left: ScoredProduct, right: ScoredProduct): number {
  switch (sort) {
    case 'price-asc':
      return left.product.price - right.product.price;
    case 'price-desc':
      return right.product.price - left.product.price;
    case 'rating-desc':
      return right.product.rating - left.product.rating;
    case 'discount-desc':
      return right.product.discountPercentage - left.product.discountPercentage;
    case 'relevance':
      return right.score - left.score || right.product.rating - left.product.rating;
    default:
      return 0;
  }
}

function isExcluded(product: NormalizedProduct, criteria: RetrievalCriteria): boolean {
  if (criteria.excludeProductIds?.includes(product.id) === true) {
    return true;
  }

  const excludedBrands = criteria.excludeBrands ?? [];
  const brand = product.brand?.toLowerCase() ?? '';
  const title = product.title.toLowerCase();
  const tokens = [...tokenize(brand), ...tokenize(title)];

  return excludedBrands.some((excludedBrand) => {
    const needle = excludedBrand.trim().toLowerCase();
    if (needle.length === 0) {
      return false;
    }
    if (tokens.includes(needle)) {
      return true;
    }
    // Substring matching is what makes exclusion work at all, because `brand` is missing on
    // 92 of 194 products and "no Apple" has to reach "Apple MacBook Pro" through the title.
    // Below the same floor the scorer uses, it stops being a brand match and starts being a
    // coincidence: "hp" is inside "whipped", "le" is inside almost everything.
    if (needle.length < MINIMUM_PARTIAL_MATCH_LENGTH) {
      return false;
    }

    return brand.includes(needle) || title.includes(needle);
  });
}

function toProductCard(product: NormalizedProduct): ProductCard {
  return {
    id: product.id,
    title: product.title,
    shortDescription: toShortDescription(product.description),
    price: product.price,
    discountPercentage: product.discountPercentage,
    effectivePrice: product.effectivePrice,
    rating: product.rating,
    thumbnail: product.thumbnail,
    category: product.category,
    availabilityStatus: product.availabilityStatus,
    minimumOrderQuantity: product.minimumOrderQuantity,
    minimumSpend: product.minimumSpend,
  };
}

function toShortDescription(description: string): string {
  const collapsed = description.trim().replace(/\s+/g, ' ');
  if (collapsed.length <= SHORT_DESCRIPTION_MAX_LENGTH) {
    return collapsed;
  }

  const clipped = collapsed.slice(0, SHORT_DESCRIPTION_MAX_LENGTH);
  const lastSpace = clipped.lastIndexOf(' ');
  const trimmed = lastSpace > 0 ? clipped.slice(0, lastSpace) : clipped;

  return `${trimmed.replace(/[),.;:-]+$/, '')}…`;
}

function normalizeSearchTerms(searchTerms: string[]): string[] {
  return searchTerms.flatMap((searchTerm) => tokenize(searchTerm));
}

function tokenizeProduct(product: NormalizedProduct): ProductTokens {
  return {
    title: tokenize(product.title),
    tags: tokenize(product.tags.join(' ')),
    description: tokenize(product.description),
    brand: tokenize(product.brand ?? ''),
  };
}

function tokenize(value: string): string[] {
  return value
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((token) => token.length > 0)
    .map((token) => singularize(token));
}

function singularize(token: string): string {
  const isPluralCandidate = token.length > 3 && token.endsWith('s') && !token.endsWith('ss');

  return isPluralCandidate ? token.slice(0, -1) : token;
}
