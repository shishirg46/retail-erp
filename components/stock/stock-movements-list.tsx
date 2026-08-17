"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { api } from "@/lib/api/client";
import type { Paginated } from "@/lib/api/types";
import { queryKeys } from "@/lib/api/query-keys";

const PAGE_SIZE = "20";

const REASON_LABELS: Record<string, string> = {
  PURCHASE: "Purchase",
  SALE: "Sale",
  DAMAGE: "Damage",
  CORRECTION: "Correction",
  VOID: "Void",
};

type MovementApi = {
  id: string;
  productId: string;
  qtyChange: number;
  reason: string;
  date: string;
  note: string | null;
  saleId: string | null;
  purchaseId: string | null;
  status: string;
  voidedAt: string | null;
  voidReason: string | null;
};

function asMovementPage(data: unknown): { movements: MovementApi[]; paging: { next: string | null; hasMore: boolean } } {
  if (data && typeof data === "object" && "data" in data && Array.isArray((data as { data: unknown }).data)) {
    const paginated = data as Paginated<MovementApi>;
    return { movements: paginated.data, paging: paginated.paging };
  }
  return {
    movements: Array.isArray(data) ? (data as MovementApi[]) : [],
    paging: { next: null, hasMore: false },
  };
}

export function StockMovementsList() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const reason = searchParams.get("reason") ?? "";
  const productId = searchParams.get("productId") ?? "";
  const cursor = searchParams.get("cursor") ?? undefined;

  const query = useQuery({
    queryKey: queryKeys.stock.movements(reason || undefined, productId || undefined, cursor),
    queryFn: () =>
      api.get<MovementApi[]>("/api/stock/movements", {
        limit: PAGE_SIZE,
        reason: reason || undefined,
        productId: productId || undefined,
        cursor: cursor || undefined,
      }),
  });

  const { movements, paging } = useMemo(() => asMovementPage(query.data), [query.data]);

  function setFilter(key: string, value: string) {
    const params = new URLSearchParams(searchParams.toString());
    if (value) params.set(key, value);
    else params.delete(key);
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
    return <p className="text-sm text-muted-foreground">Loading stock movements…</p>;
  }

  if (query.isError) {
    return (
      <Card>
        <CardContent className="p-4 text-sm text-destructive">
          {query.error instanceof Error ? query.error.message : "Failed to load stock movements."}
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          variant={!reason ? "default" : "outline"}
          size="sm"
          onClick={() => setFilter("reason", "")}
        >
          All
        </Button>
        {Object.keys(REASON_LABELS).map((r) => (
          <Button
            key={r}
            type="button"
            variant={reason === r ? "default" : "outline"}
            size="sm"
            onClick={() => setFilter("reason", r)}
          >
            {REASON_LABELS[r]}
          </Button>
        ))}
      </div>

      {movements.length === 0 ? (
        <Card>
          <CardContent className="p-6 text-center text-sm text-muted-foreground">No stock movements found</CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {movements.map((m) => (
            <Card key={m.id}>
              <CardContent className="space-y-2">
                <div className="flex items-center justify-between">
                  <Badge variant="outline">{REASON_LABELS[m.reason] ?? m.reason}</Badge>
                  <span className="text-sm text-muted-foreground">
                    {new Date(m.date).toLocaleDateString()}
                  </span>
                </div>
                <div className="flex items-center justify-between text-sm">
                  <span className="text-muted-foreground">Qty change</span>
                  <span className={`tabular-nums font-medium ${m.qtyChange > 0 ? "text-green-600" : "text-destructive"}`}>
                    {m.qtyChange > 0 ? "+" : ""}{m.qtyChange}
                  </span>
                </div>
                {m.note && (
                  <div className="text-sm text-muted-foreground">Note: {m.note}</div>
                )}
                {m.status === "VOIDED" && (
                  <Badge variant="destructive" className="text-xs">VOIDED</Badge>
                )}
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
    </div>
  );
}
