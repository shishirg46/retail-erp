"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { api } from "@/lib/api/client";
import { queryKeys } from "@/lib/api/query-keys";
import { formatRupees } from "@/lib/format/money";
import { unitsToQuantity } from "@/lib/quantity";
import type { Product } from "@/modules/products/product.types";
import type { StockMovement } from "@/modules/stock/stock.types";

type ProductApi = Product & {
  costPrice: number;
  currentPrice: number;
  stockQty: number;
  priceTiers: Array<{ minQty: number; price: number }>;
};

type MovementApi = StockMovement & {
  qtyChange: number;
  reason: string;
  status: string;
  voidedAt: string | null;
  voidReason: string | null;
};

export function ProductDetail({ id }: { id: string; role: string }) {
  const query = useQuery({
    queryKey: queryKeys.products.detail(id),
    queryFn: () => api.get<ProductApi>(`/api/products/${id}`),
  });

  const movementsQuery = useQuery({
    queryKey: ["stock", "movements", id],
    queryFn: () =>
      api.get<MovementApi[]>("/api/stock/movements", { productId: id }),
    enabled: !!id,
  });

  if (query.isPending) {
    return <p className="text-sm text-muted-foreground">Loading product…</p>;
  }

  if (query.isError) {
    return (
      <Card>
        <CardContent className="p-4 text-sm text-destructive">
          {query.error instanceof Error ? query.error.message : "Failed to load product."}
        </CardContent>
      </Card>
    );
  }

  const product = query.data;
  const movements = Array.isArray(movementsQuery.data) ? movementsQuery.data : [];

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between gap-2">
            <CardTitle className="text-base">{product.name}</CardTitle>
            <Badge variant="outline">{product.unit}</Badge>
          </div>
        </CardHeader>
        <CardContent className="space-y-2">
          <div className="flex items-center justify-between text-sm">
            <span className="text-muted-foreground">Current price</span>
            <span className="font-medium tabular-nums">{formatRupees(product.currentPrice)}/{product.unit}</span>
          </div>
          <div className="flex items-center justify-between text-sm">
            <span className="text-muted-foreground">Cost price</span>
            <span className="font-medium tabular-nums">{formatRupees(product.costPrice)}/{product.unit}</span>
          </div>
          <div className="flex items-center justify-between text-sm">
            <span className="text-muted-foreground">Stock</span>
            <span className="font-medium tabular-nums">{product.stockQty} {product.unit}</span>
          </div>
          {product.category && (
            <div className="flex items-center justify-between text-sm text-muted-foreground">
              <span>Category</span>
              <span>{product.category}</span>
            </div>
          )}
        </CardContent>
      </Card>

      {product.priceTiers.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Price tiers</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {product.priceTiers.map((tier, i) => (
              <div key={i} className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">
                  {unitsToQuantity(tier.minQty)} {product.unit}+
                </span>
                <span className="font-medium tabular-nums">{formatRupees(tier.price)}/{product.unit}</span>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Recent stock movements</CardTitle>
        </CardHeader>
        <CardContent>
          {movementsQuery.isPending ? (
            <p className="text-sm text-muted-foreground">Loading movements…</p>
          ) : movements.length === 0 ? (
            <p className="text-sm text-muted-foreground">No movements</p>
          ) : (
            <div className="space-y-2">
              {movements.slice(0, 10).map((m) => (
                <div key={m.id} className="flex items-center justify-between text-sm">
                  <div>
                    <span className="font-medium">{m.reason}</span>
                    {m.reason === "SALE" && m.saleCustomerName && (
                      <span className="ml-2 text-muted-foreground">— {m.saleCustomerName}</span>
                    )}
                    {m.reason === "PURCHASE" && m.purchaseSupplierName && (
                      <span className="ml-2 text-muted-foreground">— {m.purchaseSupplierName}</span>
                    )}
                    {m.note && m.reason !== "SALE" && m.reason !== "PURCHASE" && (
                      <span className="ml-2 text-muted-foreground">— {m.note}</span>
                    )}
                  </div>
                  <span className={`tabular-nums font-medium ${m.qtyChange > 0 ? "text-green-600" : "text-destructive"}`}>
                    {m.qtyChange > 0 ? "+" : ""}{m.qtyChange} {product.unit}
                  </span>
                </div>
              ))}
            </div>
          )}
          <div className="mt-3">
            <Link href={`/stock/movements?productId=${id}`}>
              <Button type="button" variant="outline" size="sm">View all movements</Button>
            </Link>
          </div>
        </CardContent>
      </Card>

      <div className="flex justify-end">
        <Link href="/products">
          <Button type="button" variant="outline">Back to products</Button>
        </Link>
      </div>
    </div>
  );
}
