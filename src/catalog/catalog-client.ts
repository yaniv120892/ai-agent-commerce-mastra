import { z } from 'zod';
import { rawProductSchema, type RawProduct } from './types';

// Hardcoded on purpose: the catalog origin is not env-configurable, so a bad
// environment cannot redirect catalog traffic to another host.
const CATALOG_ORIGIN = 'https://dummyjson.com';

const SELECTED_FIELDS = [
  'id',
  'title',
  'description',
  'category',
  'price',
  'discountPercentage',
  'rating',
  'stock',
  'brand',
  'tags',
  'availabilityStatus',
  'thumbnail',
  'shippingInformation',
  'returnPolicy',
  'warrantyInformation',
  'minimumOrderQuantity',
] as const;

export const CATALOG_URL = `${CATALOG_ORIGIN}/products?limit=0&select=${SELECTED_FIELDS.join(',')}`;

const MAX_LOGGED_PAYLOAD_LENGTH = 500;
const MAX_REPORTED_REJECTIONS = 5;
const MINIMUM_VALID_FRACTION = 0.5;

export type CatalogParseResult = {
  products: RawProduct[];
  totalReceived: number;
  rejections: string[];
};

const catalogEnvelopeSchema = z.object({
  products: z.unknown().array(),
});

export class CatalogRequestError extends Error {
  public readonly status: number | undefined;
  public readonly retryable: boolean;

  public constructor(
    message: string,
    options: { status?: number; retryable: boolean; cause?: unknown },
  ) {
    super(message, { cause: options.cause });
    this.name = 'CatalogRequestError';
    this.status = options.status;
    this.retryable = options.retryable;
  }
}

export class CatalogPayloadError extends Error {
  public readonly receivedPayload: string;

  public constructor(message: string, options: { receivedPayload: unknown; cause?: unknown }) {
    super(message, { cause: options.cause });
    this.name = 'CatalogPayloadError';
    this.receivedPayload = describePayload(options.receivedPayload);
  }
}

export async function fetchRawProducts(): Promise<CatalogParseResult> {
  const payload = await requestCatalogWithOneRetry();
  return parseProducts(payload);
}

async function requestCatalogWithOneRetry(): Promise<unknown> {
  try {
    return await requestCatalogOnce();
  } catch (error) {
    if (error instanceof CatalogRequestError && error.retryable) {
      return await requestCatalogOnce();
    }
    throw error;
  }
}

async function requestCatalogOnce(): Promise<unknown> {
  let response: Response;
  try {
    response = await fetch(CATALOG_URL, { headers: { accept: 'application/json' } });
  } catch (error) {
    throw new CatalogRequestError(
      `Catalog request to ${CATALOG_URL} failed before a response arrived: ${describeError(error)}`,
      { retryable: true, cause: error },
    );
  }

  if (!response.ok) {
    throw new CatalogRequestError(
      `Catalog request to ${CATALOG_URL} failed with HTTP ${response.status} ${response.statusText}`,
      { status: response.status, retryable: response.status >= 500 },
    );
  }

  try {
    return await response.json();
  } catch (error) {
    throw new CatalogPayloadError(
      `Catalog response from ${CATALOG_URL} was not valid JSON: ${describeError(error)}`,
      { receivedPayload: undefined, cause: error },
    );
  }
}

function parseProducts(payload: unknown): CatalogParseResult {
  const envelope = catalogEnvelopeSchema.safeParse(payload);
  if (!envelope.success) {
    throw new CatalogPayloadError(
      `Catalog response from ${CATALOG_URL} did not contain a products array (${formatIssues(envelope.error)}), received: ${describePayload(payload)}`,
      { receivedPayload: payload },
    );
  }

  const products: RawProduct[] = [];
  const rejections: string[] = [];
  for (const [index, entry] of envelope.data.products.entries()) {
    const product = rawProductSchema.safeParse(entry);
    if (product.success) {
      products.push(product.data);
    } else {
      rejections.push(`index ${index} (${formatIssues(product.error)})`);
    }
  }

  const totalReceived = envelope.data.products.length;
  if (isBelowValidFloor(products.length, totalReceived)) {
    throw new CatalogPayloadError(
      `Catalog response from ${CATALOG_URL} yielded only ${products.length} valid products out of ${totalReceived}, ` +
        `below the ${MINIMUM_VALID_FRACTION} floor — treating this as a changed API shape rather than catalog drift. ` +
        `Rejections: ${describeRejections(rejections)}`,
      { receivedPayload: payload },
    );
  }

  return { products, totalReceived, rejections };
}

// One unrecognised product is catalog drift and must not fail the load; a payload that is
// mostly unparseable is a changed API shape and must fail loudly.
function isBelowValidFloor(validCount: number, totalReceived: number): boolean {
  if (totalReceived === 0) {
    return false;
  }
  return validCount / totalReceived < MINIMUM_VALID_FRACTION;
}

function describeRejections(rejections: string[]): string {
  if (rejections.length <= MAX_REPORTED_REJECTIONS) {
    return rejections.join('; ');
  }
  const reported = rejections.slice(0, MAX_REPORTED_REJECTIONS).join('; ');
  return `${reported}; … and ${rejections.length - MAX_REPORTED_REJECTIONS} more`;
}

function formatIssues(error: z.ZodError): string {
  return error.issues
    .map((issue) => {
      const path = issue.path.length > 0 ? issue.path.join('.') : '<root>';
      return `${path}: ${issue.message}`;
    })
    .join('; ');
}

function describePayload(payload: unknown): string {
  if (payload === undefined) {
    return 'undefined';
  }
  const serialized = JSON.stringify(payload) ?? String(payload);
  if (serialized.length <= MAX_LOGGED_PAYLOAD_LENGTH) {
    return serialized;
  }
  return `${serialized.slice(0, MAX_LOGGED_PAYLOAD_LENGTH)}… (truncated from ${serialized.length} characters)`;
}

function describeError(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}
