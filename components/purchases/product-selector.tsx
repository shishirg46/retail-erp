"use client";

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";

import { Input } from "@/components/ui/input";
import { api } from "@/lib/api/client";
import { queryKeys } from "@/lib/api/query-keys";
import { formatRupees } from "@/lib/format/money";

export interface ProductOption {
  id: string;
  name: string;
  unit: string;
  costPrice: number;
  unitsPerPack: number | null;
}

export function ProductSelector({
  onSelect,
  excludeIds,
}: {
  onSelect: (product: ProductOption) => void;
  excludeIds?: string[];
}) {
  const [search, setSearch] = useState("");

  const query = useQuery({
    queryKey: queryKeys.products.all,
    queryFn: () => api.get<ProductOption[]>("/api/products"),
  });

  const filtered = useMemo(() => {
    const products = query.data ?? [];
    const excluded = new Set(excludeIds);
    return products.filter((p) => {
      if (excluded.has(p.id)) return false;
      if (search && !p.name.toLowerCase().includes(search.toLowerCase())) return false;
      return true;
    });
  }, [excludeIds, query.data, search]);

  if (query.isPending) {
    return <p className="text-sm text-muted-foreground">Loading products…</p>;
  }

  return (
    <div className="space-y-2">
      <Input
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder="Search products…"
      />
      <div className="max-h-60 overflow-y-auto rounded-lg border">
        {filtered.length === 0 ? (
          <p className="p-3 text-sm text-muted-foreground">No products found</p>
        ) : (
          filtered.map((product) => (
            <button
              key={product.id}
              type="button"
              className="flex w-full items-center justify-between border-b p-3 text-left text-sm hover:bg-muted last:border-b-0"
              onClick={() => {
                onSelect(product);
                setSearch("");
              }}
            >
              <div>
                <span className="font-medium">{product.name}</span>
                <span className="ml-2 text-muted-foreground">({product.unit})</span>
                {product.unitsPerPack && (
                  <span className="ml-2 text-xs text-muted-foreground">
                    {product.unitsPerPack} pcs/pack
                  </span>
                )}
              </div>
              <span className="text-muted-foreground">{formatRupees(product.costPrice)}/{product.unit}</span>
            </button>
          ))
        )}
      </div>
    </div>
  );
}
