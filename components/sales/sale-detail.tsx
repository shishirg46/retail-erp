"use client";

import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { api } from "@/lib/api/client";
import { queryKeys } from "@/lib/api/query-keys";
import { formatRupees } from "@/lib/format/money";
import { formatShopLocal } from "@/lib/timezone";
import type { SaleApi } from "@/modules/sales/sale.mapper";

export function SaleDetail({ id, role }: { id: string; role: "OWNER" | "CASHIER" }) {
  const queryClient = useQueryClient();
  const [showVoidForm, setShowVoidForm] = useState(false);
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);

  const saleQuery = useQuery({
    queryKey: queryKeys.sales.detail(id),
    queryFn: async () => api.get<SaleApi>(`/api/sales/${id}`),
  });

  const voidMutation = useMutation({
    mutationFn: async (payload: { reason: string }) => api.post<{ message?: string }>(`/api/sales/${id}/void`, payload),
    onSuccess: () => {
      setError(null);
      setShowVoidForm(false);
      setReason("");
      queryClient.invalidateQueries({ queryKey: queryKeys.sales.all });
      queryClient.invalidateQueries({ queryKey: queryKeys.sales.detail(id) });
      void saleQuery.refetch();
    },
    onError: (err) => {
      setError(err instanceof Error ? err.message : "Void failed");
    },
  });

  const sale = useMemo(() => saleQuery.data, [saleQuery.data]);

  if (saleQuery.isPending) {
    return <p className="text-sm text-muted-foreground">Loading sale…</p>;
  }

  if (saleQuery.isError || !sale) {
    return (
      <Card>
        <CardContent className="p-4 text-sm text-destructive">
          {saleQuery.error instanceof Error ? saleQuery.error.message : "Failed to load sale."}
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between gap-2">
            <CardTitle>Sale #{sale.id}</CardTitle>
            <Badge variant={sale.status === "VOIDED" ? "secondary" : "default"}>{sale.status}</Badge>
          </div>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          <div className="flex items-center justify-between">
            <span className="text-muted-foreground">Date</span>
            <span>{formatShopLocal(new Date(sale.date))}</span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-muted-foreground">Payment</span>
            <span>{sale.paymentType}</span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-muted-foreground">Total</span>
            <span className="text-lg font-semibold tabular-nums">{formatRupees(sale.total)}</span>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Items</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {sale.items.map((item) => (
            <div key={item.id} className="flex items-center justify-between gap-3 rounded-lg border p-3">
              <div>
                <p className="font-medium">#{item.productId}</p>
                <p className="text-xs text-muted-foreground tabular-nums">
                  {item.qty} × {formatRupees(item.pricePerUnit)}
                </p>
              </div>
              <span className="font-medium tabular-nums">{formatRupees(item.pricePerUnit * item.qty)}</span>
            </div>
          ))}
        </CardContent>
      </Card>

      {role === "OWNER" && !sale.status.toLowerCase().includes("void") ? (
        <div className="space-y-3">
          {!showVoidForm ? (
            <Button type="button" variant="destructive" onClick={() => setShowVoidForm(true)}>
              Void sale
            </Button>
          ) : (
            <Card>
              <CardContent className="space-y-3 p-4">
                <label htmlFor="void-reason" className="block text-sm font-medium">
                  Void reason
                </label>
                <Input
                  id="void-reason"
                  value={reason}
                  onChange={(event) => setReason(event.target.value)}
                  placeholder="Customer requested refund"
                />
                {error ? <p className="text-sm text-destructive">{error}</p> : null}
                <div className="flex gap-2">
                  <Button
                    type="button"
                    variant="destructive"
                    disabled={!reason.trim() || voidMutation.isPending}
                    onClick={() => voidMutation.mutate({ reason: reason.trim() })}
                  >
                    {voidMutation.isPending ? "Confirming…" : "Confirm void"}
                  </Button>
                  <Button type="button" variant="outline" onClick={() => setShowVoidForm(false)}>
                    Cancel
                  </Button>
                </div>
              </CardContent>
            </Card>
          )}
        </div>
      ) : null}
    </div>
  );
}
