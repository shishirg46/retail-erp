"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { api, ApiError } from "@/lib/api/client";
import type { Paginated } from "@/lib/api/types";
import { queryKeys } from "@/lib/api/query-keys";
import { formatRupees } from "@/lib/format/money";
import { formatShopLocal } from "@/lib/timezone";
import { OWNER } from "@/lib/auth/roles";

interface SupplierPaymentApi {
  id: string;
  supplierId: string;
  amount: number;
  date: string;
  status: "ACTIVE" | "VOIDED";
  voidedAt: string | null;
  voidReason: string | null;
}

function VoidPaymentForm({
  paymentId,
  onDone,
}: {
  paymentId: string;
  onDone: () => void;
}) {
  const queryClient = useQueryClient();
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);

  const voidMutation = useMutation({
    mutationFn: async (payload: { reason: string }) =>
      api.post(`/api/supplier-payments/${paymentId}/void`, payload),
    onSuccess: () => {
      setError(null);
      setReason("");
      queryClient.invalidateQueries({ queryKey: queryKeys.supplierPayments.all });
      queryClient.invalidateQueries({ queryKey: queryKeys.suppliers.all });
      onDone();
    },
    onError: (err) => {
      setError(err instanceof ApiError ? err.message : "Void failed");
    },
  });

  return (
    <Card>
      <CardContent className="space-y-3 p-4">
        <label htmlFor={`void-reason-${paymentId}`} className="block text-sm font-medium">
          Void reason
        </label>
        <Input
          id={`void-reason-${paymentId}`}
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="Reason for voiding"
        />
        {error && <p className="text-sm text-destructive">{error}</p>}
        <div className="flex gap-2">
          <Button
            type="button"
            variant="destructive"
            disabled={!reason.trim() || voidMutation.isPending}
            onClick={() => voidMutation.mutate({ reason: reason.trim() })}
          >
            {voidMutation.isPending ? "Confirming…" : "Confirm void"}
          </Button>
          <Button type="button" variant="outline" onClick={onDone}>
            Cancel
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

export function SupplierPaymentHistory({ supplierId, role }: { supplierId: string; role: string }) {
  const [voidingId, setVoidingId] = useState<string | null>(null);

  const query = useQuery({
    queryKey: queryKeys.supplierPayments.list(supplierId),
    queryFn: async () =>
      api.get<Paginated<SupplierPaymentApi> | SupplierPaymentApi[]>("/api/supplier-payments", {
        supplierId,
        limit: "50",
      }),
    enabled: !!supplierId,
  });

  function asPayments(data: unknown): SupplierPaymentApi[] {
    if (data && typeof data === "object" && "data" in data && Array.isArray((data as { data: unknown }).data)) {
      return (data as Paginated<SupplierPaymentApi>).data;
    }
    return Array.isArray(data) ? (data as SupplierPaymentApi[]) : [];
  }

  const payments = asPayments(query.data);

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base">Payment history</CardTitle>
      </CardHeader>
      <CardContent>
        {query.isPending ? (
          <p className="text-sm text-muted-foreground">Loading payments…</p>
        ) : query.isError ? (
          <p className="text-sm text-destructive">
            {query.error instanceof Error ? query.error.message : "Failed to load payments."}
          </p>
        ) : payments.length === 0 ? (
          <p className="text-sm text-muted-foreground">No payments yet</p>
        ) : (
          <div className="space-y-2">
            {payments.map((payment) => (
              <div key={payment.id}>
                <div className="flex items-center justify-between gap-3 rounded-lg border p-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium tabular-nums">
                        {formatRupees(payment.amount)}
                      </span>
                      <Badge variant={payment.status === "VOIDED" ? "secondary" : "default"}>
                        {payment.status}
                      </Badge>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      {formatShopLocal(new Date(payment.date))}
                    </p>
                    {payment.status === "VOIDED" && payment.voidReason && (
                      <p className="text-xs text-muted-foreground">Void: {payment.voidReason}</p>
                    )}
                  </div>
                  {role === OWNER && payment.status === "ACTIVE" && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="shrink-0 text-destructive"
                      onClick={() => setVoidingId(voidingId === payment.id ? null : payment.id)}
                    >
                      Void
                    </Button>
                  )}
                </div>
                {voidingId === payment.id && (
                  <div className="mt-2">
                    <VoidPaymentForm paymentId={payment.id} onDone={() => setVoidingId(null)} />
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
