const CURRENCY_FORMATTER = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
});

// A discount that rounds to zero would render as "0% off", which reads as a bug
// rather than as a full-price product.
const SMALLEST_DISPLAYABLE_DISCOUNT_PERCENTAGE = 0.5;

export function formatPrice(amount: number): string {
  return CURRENCY_FORMATTER.format(amount);
}

export function isDiscounted(discountPercentage: number): boolean {
  return discountPercentage >= SMALLEST_DISPLAYABLE_DISCOUNT_PERCENTAGE;
}

export function formatDiscount(discountPercentage: number): string {
  return `${Math.round(discountPercentage)}% off`;
}

export function formatRating(rating: number): string {
  return rating.toFixed(1);
}

export function hasMinimumOrder(minimumOrderQuantity: number): boolean {
  return minimumOrderQuantity > 1;
}

export function formatMinimumOrder(minimumOrderQuantity: number, minimumSpend: number): string {
  return `Min. order ${minimumOrderQuantity} · ${formatPrice(minimumSpend)}`;
}
