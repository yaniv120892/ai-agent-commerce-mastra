import Image from 'next/image';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import type { AvailabilityStatus, ProductCard as ProductCardData } from '@/catalog/types';
import {
  formatDiscount,
  formatMinimumOrder,
  formatPrice,
  formatRating,
  hasMinimumOrder,
  isDiscounted,
} from './product-formatting';

type ProductCardProps = {
  product: ProductCardData;
};

type AvailabilityBadgeVariant = 'secondary' | 'outline' | 'destructive';

// An object rather than a Set so a new availability status fails to compile until
// somebody decides how it should look.
const BADGE_VARIANT_BY_AVAILABILITY = {
  'In Stock': 'secondary',
  'Low Stock': 'outline',
  'Out of Stock': 'destructive',
} satisfies Record<AvailabilityStatus, AvailabilityBadgeVariant>;

export function ProductCard({ product }: ProductCardProps) {
  return (
    <Card size="sm" data-testid="product-card" className="gap-0 py-0">
      <div className="bg-muted flex h-36 items-center justify-center overflow-hidden">
        <Image
          src={product.thumbnail}
          alt={product.title}
          width={320}
          height={320}
          unoptimized
          className="h-full w-full object-contain p-2"
        />
      </div>
      <CardContent className="flex flex-col gap-2 py-3">
        <div className="flex items-start justify-between gap-2">
          <h3 className="text-sm leading-snug font-medium">{product.title}</h3>
          <span className="text-muted-foreground shrink-0 text-xs tabular-nums">
            ★ {formatRating(product.rating)}
          </span>
        </div>

        <p className="text-muted-foreground line-clamp-2 text-xs">{product.shortDescription}</p>

        <ProductPrice product={product} />

        <div className="flex flex-wrap items-center gap-1.5">
          <Badge variant={BADGE_VARIANT_BY_AVAILABILITY[product.availabilityStatus]}>
            {product.availabilityStatus}
          </Badge>
          {hasMinimumOrder(product.minimumOrderQuantity) ? (
            <Badge variant="outline" className="font-normal tabular-nums">
              {formatMinimumOrder(product.minimumOrderQuantity, product.minimumSpend)}
            </Badge>
          ) : null}
        </div>
      </CardContent>
    </Card>
  );
}

export function ProductCardSkeleton() {
  return (
    <Card size="sm" data-testid="product-card-skeleton" className="gap-0 py-0">
      <Skeleton className="h-36 rounded-none" />
      <CardContent className="flex flex-col gap-2 py-3">
        <Skeleton className="h-4 w-3/4" />
        <Skeleton className="h-3 w-full" />
        <Skeleton className="h-3 w-5/6" />
        <Skeleton className="h-4 w-1/2" />
      </CardContent>
    </Card>
  );
}

function ProductPrice({ product }: ProductCardProps) {
  if (!isDiscounted(product.discountPercentage)) {
    return <p className="text-sm font-semibold tabular-nums">{formatPrice(product.price)}</p>;
  }

  return (
    <p className="flex flex-wrap items-baseline gap-1.5 text-sm tabular-nums">
      <span className="text-muted-foreground line-through">{formatPrice(product.price)}</span>
      <span className="font-semibold">{formatPrice(product.effectivePrice)}</span>
      <span className="text-muted-foreground text-xs">
        {formatDiscount(product.discountPercentage)}
      </span>
    </p>
  );
}
