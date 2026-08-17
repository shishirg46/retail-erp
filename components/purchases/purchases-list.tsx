"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { api } from "@/lib/api/client";
import type { Paginated } from "@/lib/api/types";
import { queryKeys } from "@/lib/api/query-keys";
import { formatRupees } from "@/lib/format/money";
import { formatShopLocal } from "@/lib/timezone";
import type { Supplier } from "@/modules/suppliers/supplier.types";

interface PurchaseItemApi {
  id: string;
  purchaseId: string;
  productId: string;
  productName: string;
  qty: number;
  costPerUnit: number;
}

interface PurchaseApi {
  id: string;
  supplierId: string;
  paymentType: "CASH" | "CREDIT";
  total: number;
  date: string;
  items: PurchaseItemApi[];
  status: "ACTIVE" | "VOIDED";
  voidedAt: string | null;
  voidReason: string | null;
}

const PAGE_SIZE = "10";

function asPurchasePage(data: unknown): { purchases: PurchaseApi[]; paging: { next: string | null; hasMore: boolean } } {
  if (data && typeof data === "object" && "data" in data && Array.isArray((data as { data: unknown }).data)) {
    const paginated = data as Paginated<PurchaseApi>;
    return { purchases: paginated.data, paging: paginated.paging };
  }
  return {
    purchases: Array.isArray(data) ? (data as PurchaseApi[]) : [],
    paging: { next: null, hasMore: false },
  };
}

export function PurchasesList() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const paymentType = searchParams.get("paymentType") ?? "";
  const supplierId = searchParams.get("supplierId") ?? "";
  const cursor = searchParams.get("cursor") ?? undefined;

  const query = useQuery({
    queryKey: queryKeys.purchases.list(paymentType || undefined, supplierId || undefined, cursor),
    queryFn: async () =>
      api.get<Paginated<PurchaseApi> | PurchaseApi[]>("/api/purchases", {
        limit: PAGE_SIZE,
        paymentType: paymentType || undefined,
        supplierId: supplierId || undefined,
        cursor: cursor || undefined,
      }),
  });

  const suppliersQuery = useQuery({
    queryKey: queryKeys.suppliers.all,
    queryFn: () => api.get<Supplier[]>("/api/suppliers"),
  });

  const supplierMap = useMemo(() => {
    const map = new Map<string, string>();
    for (const s of suppliersQuery.data ?? []) map.set(s.id, s.name);
    return map;
  }, [suppliersQuery.data]);

  const { purchases, paging } = useMemo(() => asPurchasePage(query.data), [query.data]);

  function setFilter(key: string, value: string) {
    const params = new URLSearchParams(searchParams.toString());
    if (value) params.set(key, value);
    else params.delete(key);
    params.delete("cursor");
    router.replace(`${pathname}?${params.toString()}`, { scroll: false });
  }

  function setPage(nextCursor: string | null) {
    const params = new URLSearchParams(searchParams.toString());
    if (nextCursor) params.set("cursor", nextCursor);
    else params.delete("cursor");
    router.replace(`${pathname}?${params.toString()}`, { scroll: false });
  }

  if (query.isPending) {
    return <p className="text-sm text-muted-foreground">Loading purchases…</p>;
  }

  if (query.isError) {
    return (
      <Card>
        <CardContent className="p-4 text-sm text-destructive">
          {query.error instanceof Error ? query.error.message : "Failed to load purchases."}
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2">
        <div className="flex gap-1">
          <Button
            type="button"
            variant={!paymentType ? "default" : "outline"}
            size="sm"
            onClick={() => setFilter("paymentType", "")}
          >
            All
          </Button>
          <Button
            type="button"
            variant={paymentType === "CASH" ? "default" : "outline"}
            size="sm"
            onClick={() => setFilter("paymentType", "CASH")}
          >
            CASH
          </Button>
          <Button
            type="button"
            variant={paymentType === "CREDIT" ? "default" : "outline"}
            size="sm"
            onClick={() => setFilter("paymentType", "CREDIT")}
          >
            CREDIT
          </Button>
        </div>

        {suppliersQuery.data && suppliersQuery.data.length > 0 && (
          <select
            value={supplierId}
            onChange={(e) => setFilter("supplierId", e.target.value)}
            className="h-8 rounded-md border border-input bg-transparent px-2 text-xs"
          >
            <option value="">All suppliers</option>
            {suppliersQuery.data.map((s) => (
              <option key={s.id} value={s.id}>{s.name}</option>
            ))}
          </select>
        )}
      </div>

      {purchases.length === 0 ? (
        <Card>
          <CardContent className="p-6 text-center text-sm text-muted-foreground">No purchases found</CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {purchases.map((purchase) => (
            <Card key={purchase.id}>
              <CardContent className="p-4 space-y-2">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-sm font-medium">
                      {supplierMap.get(purchase.supplierId) ?? "Unknown supplier"}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {formatShopLocal(new Date(purchase.date))}
                    </p>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <Badge variant="outline">{purchase.paymentType}</Badge>
                    {purchase.status === "VOIDED" && (
                      <Badge variant="secondary">VOIDED</Badge>
                    )}
                  </div>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-sm font-semibold tabular-nums">{formatRupees(purchase.total)}</span>
                  <Link href={`/purchases/${purchase.id}`} aria-label={`View purchase ${purchase.id}`}>
                    <Button type="button" variant="outline" size="sm">View</Button>
                  </Link>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <div className="flex justify-between gap-2">
        <Button type="button" variant="outline" size="sm" disabled={!cursor} onClick={() => setPage(null)}>
          Previous
        </Button>
        <Button type="button" variant="outline" size="sm" disabled={!paging.hasMore} onClick={() => setPage(paging.next)}>
          Next page
        </Button>
      </div>

      <div className="flex justify-end">
        <Link href="/purchases/new">
          <Button type="button">New purchase</Button>
        </Link>
      </div>
    </div>
  );
}
