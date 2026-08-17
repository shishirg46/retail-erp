"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { api } from "@/lib/api/client";
import type { Paginated } from "@/lib/api/types";
import { queryKeys } from "@/lib/api/query-keys";
import { formatRupees } from "@/lib/format/money";
import { OWNER, type Role } from "@/lib/auth/roles";
import type { Product } from "@/modules/products/product.types";

const PAGE_SIZE = "10";

type ProductApi = Product & {
  costPrice: number;
  currentPrice: number;
  stockQty: number;
  priceTiers: Array<{ id: string; minQty: number; price: number }>;
};

function asProductPage(data: unknown): { products: ProductApi[]; paging: { next: string | null; hasMore: boolean } } {
  if (data && typeof data === "object" && "data" in data && Array.isArray((data as { data: unknown }).data)) {
    const paginated = data as Paginated<ProductApi>;
    return { products: paginated.data, paging: paginated.paging };
  }
  return {
    products: Array.isArray(data) ? (data as ProductApi[]) : [],
    paging: { next: null, hasMore: false },
  };
}

export function ProductsList({ role }: { role: Role }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const search = searchParams.get("search") ?? "";
  const category = searchParams.get("category") ?? "";
  const cursor = searchParams.get("cursor") ?? undefined;

  const [searchInput, setSearchInput] = useState(search);

  const query = useQuery({
    queryKey: queryKeys.products.list(search || undefined, category || undefined, cursor),
    queryFn: async () =>
      api.get<Paginated<ProductApi> | ProductApi[]>("/api/products", {
        limit: PAGE_SIZE,
        search: search || undefined,
        category: category || undefined,
        cursor: cursor || undefined,
      }),
  });

  const { products, paging } = useMemo(() => asProductPage(query.data), [query.data]);

  const categories = useMemo(() => {
    const set = new Set<string>();
    for (const p of products) {
      if (p.category) set.add(p.category);
    }
    return Array.from(set).sort();
  }, [products]);

  function applySearch() {
    const params = new URLSearchParams(searchParams.toString());
    if (searchInput.trim()) params.set("search", searchInput.trim());
    else params.delete("search");
    params.delete("cursor");
    params.set("limit", PAGE_SIZE);
    router.replace(`${pathname}?${params.toString()}`, { scroll: false });
  }

  function setCategory(cat: string) {
    const params = new URLSearchParams(searchParams.toString());
    if (cat) params.set("category", cat);
    else params.delete("category");
    params.delete("cursor");
    params.set("limit", PAGE_SIZE);
    router.replace(`${pathname}?${params.toString()}`, { scroll: false });
  }

  function setPage(nextCursor: string | null) {
    const params = new URLSearchParams(searchParams.toString());
    if (nextCursor) params.set("cursor", nextCursor);
    else params.delete("cursor");
    router.replace(`${pathname}?${params.toString()}`, { scroll: false });
  }

  if (query.isPending) {
    return <p className="text-sm text-muted-foreground">Loading products…</p>;
  }

  if (query.isError) {
    return (
      <Card>
        <CardContent className="p-4 text-sm text-destructive">
          {query.error instanceof Error ? query.error.message : "Failed to load products."}
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex gap-2">
        <Input
          value={searchInput}
          onChange={(e) => setSearchInput(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") applySearch(); }}
          placeholder="Search products…"
          className="flex-1"
        />
        <Button type="button" variant="outline" onClick={applySearch}>Search</Button>
      </div>

      {categories.length > 0 && (
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            variant={!category ? "default" : "outline"}
            size="sm"
            onClick={() => setCategory("")}
          >
            All
          </Button>
          {categories.map((cat) => (
            <Button
              key={cat}
              type="button"
              variant={category === cat ? "default" : "outline"}
              size="sm"
              onClick={() => setCategory(cat)}
            >
              {cat}
            </Button>
          ))}
        </div>
      )}

      {products.length === 0 ? (
        <Card>
          <CardContent className="p-6 text-center text-sm text-muted-foreground">No products found</CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {products.map((product) => (
            <Card key={product.id}>
              <CardHeader className="pb-2">
                <div className="flex items-center justify-between gap-2">
                  <CardTitle className="text-base">{product.name}</CardTitle>
                  <Badge variant="outline">{product.unit}</Badge>
                </div>
              </CardHeader>
              <CardContent className="space-y-2">
                <div className="flex items-center justify-between text-sm text-muted-foreground">
                  <span>Price</span>
                  <span>{formatRupees(product.currentPrice)}/{product.unit}</span>
                </div>
                <div className="flex items-center justify-between text-sm text-muted-foreground">
                  <span>Cost</span>
                  <span>{formatRupees(product.costPrice)}/{product.unit}</span>
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
                <div className="flex justify-end">
                  <Link href={`/products/${product.id}`} className="inline-flex items-center" aria-label={`View ${product.name}`}>
                    <Button type="button" variant="outline" size="sm">View product</Button>
                  </Link>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <div className="flex justify-between gap-2">
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={!cursor}
          onClick={() => setPage(null)}
        >
          Previous
        </Button>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={!paging.hasMore}
          onClick={() => setPage(paging.next)}
        >
          Next page
        </Button>
      </div>

      {role === OWNER && (
        <div className="flex justify-end">
          <Link href="/products/new">
            <Button type="button">New product</Button>
          </Link>
        </div>
      )}
    </div>
  );
}
