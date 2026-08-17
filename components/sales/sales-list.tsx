"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { api } from "@/lib/api/client";
import type { Paginated } from "@/lib/api/types";
import { queryKeys } from "@/lib/api/query-keys";
import { formatRupees } from "@/lib/format/money";
import { formatShopLocal } from "@/lib/timezone";
import type { SaleApi } from "@/modules/sales/sale.mapper";

const PAGE_SIZE = "10";
const paymentOptions = [
  { value: "", label: "All" },
  { value: "CASH", label: "Cash" },
  { value: "ECASH", label: "E-Cash" },
  { value: "CREDIT", label: "Credit" },
] as const;

function paymentLabel(value: string): string {
  return paymentOptions.find((option) => option.value === value)?.label ?? value;
}

function asSalesPage(data: unknown): { sales: SaleApi[]; paging: { next: string | null; hasMore: boolean } } {
  if (data && typeof data === "object" && "data" in data && Array.isArray((data as { data: unknown }).data)) {
    const paginated = data as Paginated<SaleApi>;
    return { sales: paginated.data, paging: paginated.paging };
  }

  return {
    sales: Array.isArray(data) ? (data as SaleApi[]) : [],
    paging: { next: null, hasMore: false },
  };
}

export function SalesList({ role }: { role: "OWNER" | "CASHIER" }) {
  void role;
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const paymentType = searchParams.get("paymentType") ?? "";
  const cursor = searchParams.get("cursor") ?? undefined;

  const query = useQuery({
    queryKey: queryKeys.sales.list(paymentType || undefined, cursor),
    queryFn: async () =>
      api.get<Paginated<SaleApi> | SaleApi[]>("/api/sales", {
        limit: PAGE_SIZE,
        paymentType: paymentType || undefined,
        cursor: cursor || undefined,
      }),
  });

  const { sales, paging } = useMemo(() => asSalesPage(query.data), [query.data]);

  function setQuery(next: { paymentType?: string; cursor?: string | null }) {
    const params = new URLSearchParams(searchParams.toString());
    if (next.paymentType) params.set("paymentType", next.paymentType);
    else params.delete("paymentType");

    if (next.cursor) params.set("cursor", next.cursor);
    else params.delete("cursor");

    params.set("limit", PAGE_SIZE);
    router.replace(`${pathname}?${params.toString()}`, { scroll: false });
  }

  if (query.isPending) {
    return <p className="text-sm text-muted-foreground">Loading sales…</p>;
  }

  if (query.isError) {
    return (
      <Card>
        <CardContent className="p-4 text-sm text-destructive">
          {query.error instanceof Error ? query.error.message : "Failed to load sales."}
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2">
        {paymentOptions.map((option) => {
          const active = paymentType === option.value;
          return (
            <Button
              key={option.value || "all"}
              type="button"
              variant={active ? "default" : "outline"}
              size="sm"
              onClick={() => setQuery({ paymentType: option.value, cursor: null })}
            >
              {option.label}
            </Button>
          );
        })}
      </div>

      {sales.length === 0 ? (
        <Card>
          <CardContent className="p-6 text-center text-sm text-muted-foreground">No sales found</CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {sales.map((sale) => (
            <Card key={sale.id}>
              <CardHeader className="pb-2">
                <div className="flex items-center justify-between gap-2">
                  <CardTitle className="text-base">Sale #{sale.id}</CardTitle>
                  <Badge variant={sale.status === "VOIDED" ? "secondary" : "default"}>
                    {sale.status}
                  </Badge>
                </div>
              </CardHeader>
              <CardContent className="space-y-2">
                <div className="flex items-center justify-between text-sm text-muted-foreground">
                  <span>{paymentLabel(sale.paymentType)}</span>
                  <span>{formatShopLocal(new Date(sale.date))}</span>
                </div>
                <div className="flex items-center justify-between gap-2">
                  <span className="text-sm text-muted-foreground">Total</span>
                  <span className="text-lg font-semibold tabular-nums">{formatRupees(sale.total)}</span>
                </div>
                <div className="flex items-center justify-between gap-2">
                  <span className="text-sm text-muted-foreground">Items</span>
                  <span className="text-sm font-medium tabular-nums">{sale.items.length}</span>
                </div>
                <div className="flex justify-end">
                  <Link href={`/sales/${sale.id}`} className="inline-flex items-center" aria-label={`View sale ${sale.id}`}>
                    <Button type="button" variant="outline" size="sm">
                      View sale
                    </Button>
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
          onClick={() => setQuery({ paymentType: paymentType || undefined, cursor: null })}
        >
          Previous
        </Button>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={!paging.hasMore}
          onClick={() => setQuery({ paymentType: paymentType || undefined, cursor: paging.next })}
        >
          Next page
        </Button>
      </div>
    </div>
  );
}
