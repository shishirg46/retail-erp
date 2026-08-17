"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { api } from "@/lib/api/client";
import { queryKeys } from "@/lib/api/query-keys";
import { formatRupees } from "@/lib/format/money";
import { formatShopLocal } from "@/lib/timezone";
import { OWNER } from "@/lib/auth/roles";
import type { Supplier } from "@/modules/suppliers/supplier.types";
import { PurchaseVoidForm } from "./purchase-void-form";

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

export function PurchaseDetail({ id, role }: { id: string; role: string }) {
  const [showVoidForm, setShowVoidForm] = useState(false);

  const purchaseQuery = useQuery({
    queryKey: queryKeys.purchases.detail(id),
    queryFn: () => api.get<PurchaseApi>(`/api/purchases/${id}`),
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

  if (purchaseQuery.isPending) {
    return <p className="text-sm text-muted-foreground">Loading purchase…</p>;
  }

  if (purchaseQuery.isError) {
    return (
      <Card>
        <CardContent className="p-4 text-sm text-destructive">
          {purchaseQuery.error instanceof Error ? purchaseQuery.error.message : "Failed to load purchase."}
        </CardContent>
      </Card>
    );
  }

  const purchase = purchaseQuery.data;

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between">
            <CardTitle className="text-base">Purchase</CardTitle>
            <Badge variant={purchase.status === "VOIDED" ? "secondary" : "default"}>
              {purchase.status}
            </Badge>
          </div>
        </CardHeader>
        <CardContent className="space-y-2">
          <div className="flex items-center justify-between text-sm">
            <span className="text-muted-foreground">Supplier</span>
            <span className="font-medium">
              {supplierMap.get(purchase.supplierId) ?? purchase.supplierId}
            </span>
          </div>
          <div className="flex items-center justify-between text-sm">
            <span className="text-muted-foreground">Payment type</span>
            <Badge variant="outline">{purchase.paymentType}</Badge>
          </div>
          <div className="flex items-center justify-between text-sm">
            <span className="text-muted-foreground">Date</span>
            <span>{formatShopLocal(new Date(purchase.date))}</span>
          </div>
          <div className="flex items-center justify-between text-sm">
            <span className="text-muted-foreground">Total</span>
            <span className="font-semibold tabular-nums">{formatRupees(purchase.total)}</span>
          </div>
          {purchase.status === "VOIDED" && purchase.voidReason && (
            <div className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground">Void reason</span>
              <span className="text-destructive">{purchase.voidReason}</span>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Items</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-2">
            {purchase.items.map((item) => (
              <div key={item.id} className="flex items-center justify-between gap-3 rounded-lg border p-3">
                <div className="min-w-0">
                  <p className="text-sm font-medium">{item.productName}</p>
                  <p className="text-xs text-muted-foreground">
                    {item.qty} × {formatRupees(item.costPerUnit)}
                  </p>
                </div>
                <span className="text-sm font-medium tabular-nums shrink-0">
                  {formatRupees(item.qty * item.costPerUnit)}
                </span>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {role === OWNER && purchase.status === "ACTIVE" && (
        <div className="space-y-3">
          {showVoidForm ? (
            <PurchaseVoidForm purchaseId={id} onDone={() => setShowVoidForm(false)} />
          ) : (
            <Button
              type="button"
              variant="destructive"
              onClick={() => setShowVoidForm(true)}
            >
              Void purchase
            </Button>
          )}
        </div>
      )}

      <div className="flex justify-end">
        <Link href="/purchases">
          <Button type="button" variant="outline">Back to purchases</Button>
        </Link>
      </div>
    </div>
  );
}
