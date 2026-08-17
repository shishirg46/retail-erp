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

interface CreditPaymentApi {
  id: string;
  customerId: string;
  saleId: string | null;
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
      api.post(`/api/customer-payments/${paymentId}/void`, payload),
    onSuccess: () => {
      setError(null);
      setReason("");
      queryClient.invalidateQueries({ queryKey: queryKeys.customerPayments.all });
      queryClient.invalidateQueries({ queryKey: queryKeys.customers.all });
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

export function PaymentHistory({ customerId, role }: { customerId: string; role: string }) {
  const [voidingId, setVoidingId] = useState<string | null>(null);

  const query = useQuery({
    queryKey: queryKeys.customerPayments.list(customerId),
    queryFn: async () =>
      api.get<Paginated<CreditPaymentApi> | CreditPaymentApi[]>("/api/customer-payments", {
        customerId,
        limit: "50",
      }),
    enabled: !!customerId,
  });

  function asPayments(data: unknown): CreditPaymentApi[] {
    if (data && typeof data === "object" && "data" in data && Array.isArray((data as { data: unknown }).data)) {
      return (data as Paginated<CreditPaymentApi>).data;
    }
    return Array.isArray(data) ? (data as CreditPaymentApi[]) : [];
  }

  const payments = asPayments(query.data);

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base">Recent payments</CardTitle>
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
                      {payment.saleId && ` · linked to sale`}
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
