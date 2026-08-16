"use client";

import { Plus } from "lucide-react";

import { cheapestTier, tierHint } from "@/lib/format/tiers";
import { formatRupees } from "@/lib/format/money";
import { cn } from "@/lib/utils";
import type { Product } from "@/modules/products/product.types";

// POS product tile (plan §12.1). The whole card is one tap target: tapping it
// adds one unit to the cart. Stock and the lowest tier threshold are shown
// inline; the server remains authoritative for availability and the final
// price (D1, D22.2).
export function ProductCard({
  product,
  onAdd,
}: {
  product: Product;
  onAdd: (product: Product) => void;
}) {
  const outOfStock = product.stockQty <= 0;
  const tier = cheapestTier(product.priceTiers);

  return (
    <button
      type="button"
      onClick={() => onAdd(product)}
      disabled={outOfStock}
      aria-label={`Add ${product.name} to cart`}
      className={cn(
        "flex min-h-[96px] flex-col gap-0.5 rounded-xl border bg-card p-3 text-left outline-none transition-colors",
        "hover:bg-muted focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 active:bg-muted",
        "disabled:cursor-not-allowed disabled:opacity-45"
      )}
    >
      <span className="flex items-start justify-between gap-2">
        <span className="line-clamp-2 text-sm font-medium leading-tight">{product.name}</span>
        <Plus className="size-5 shrink-0 text-primary" aria-hidden />
      </span>
      <span className="mt-auto text-base font-semibold tabular-nums">
        {formatRupees(product.currentPrice)}
        <span className="text-xs font-normal text-muted-foreground"> / {product.unit}</span>
      </span>
      {outOfStock ? (
        <span className="text-xs font-medium text-destructive">Out of stock</span>
      ) : (
        <span className="text-xs text-muted-foreground">Stock {product.stockQty}</span>
      )}
      {tier ? <span className="text-xs font-medium text-primary">{tierHint(tier)}</span> : null}
    </button>
  );
}
