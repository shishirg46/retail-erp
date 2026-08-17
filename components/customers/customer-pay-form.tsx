"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { api, ApiError } from "@/lib/api/client";
import type { Paginated } from "@/lib/api/types";
import { queryKeys } from "@/lib/api/query-keys";
import { formatSignedRupees } from "@/lib/format/money";
import type { Customer } from "@/modules/customers/customer.types";
import { toast } from "sonner";

interface SaleSummary {
  id: string;
  total: number;
  date: string;
  paymentType: string;
}

export function CustomerPayForm({ customerId }: { customerId: string }) {
  const router = useRouter();
  const queryClient = useQueryClient();

  const [amount, setAmount] = useState("");
  const [saleId, setSaleId] = useState("");
  const [error, setError] = useState<string | null>(null);

  const customerQuery = useQuery({
    queryKey: queryKeys.customers.detail(customerId),
    queryFn: () => api.get<Customer>(`/api/customers/${customerId}`),
  });

  const salesQuery = useQuery({
    queryKey: ["sales", "credit", customerId],
    queryFn: async () => {
      const res = await api.get<Paginated<SaleSummary> | SaleSummary[]>("/api/sales", {
        paymentType: "CREDIT",
        limit: "50",
      });
      if (res && typeof res === "object" && "data" in res && Array.isArray((res as { data: unknown }).data)) {
        return (res as Paginated<SaleSummary>).data;
      }
      return Array.isArray(res) ? (res as SaleSummary[]) : [];
    },
  });

  const mutation = useMutation({
    mutationFn: async () => {
      const parsedAmount = parseFloat(amount);
      if (Number.isNaN(parsedAmount) || parsedAmount <= 0) {
        throw new ApiError(400, "Amount must be a positive number");
      }

      const body: { customerId: string; amount: number; saleId?: string } = {
        customerId,
        amount: parsedAmount,
      };
      if (saleId.trim()) body.saleId = saleId.trim();

      return api.post("/api/customer-payments", body);
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.customerPayments.all });
      await queryClient.invalidateQueries({ queryKey: queryKeys.customers.all });
      toast.success("Payment received");
      router.push(`/customers/${customerId}`);
    },
    onError: (err: ApiError) => {
      setError(err.message);
    },
  });

  const customer = customerQuery.data;

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Receive payment</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {customerQuery.isPending ? (
            <p className="text-sm text-muted-foreground">Loading customer…</p>
          ) : customerQuery.isError ? (
            <p className="text-sm text-destructive">
              {customerQuery.error instanceof Error ? customerQuery.error.message : "Failed to load customer."}
            </p>
          ) : customer ? (
            <>
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">Customer</span>
                <span className="font-medium">{customer.name}</span>
              </div>
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">Current balance</span>
                <span className={`font-medium tabular-nums ${customer.balanceOwed > 0 ? "text-destructive" : customer.balanceOwed < 0 ? "text-green-600" : ""}`}>
                  {formatSignedRupees(customer.balanceOwed)}
                </span>
              </div>
            </>
          ) : null}
        </CardContent>
      </Card>

      <Card>
        <CardContent className="space-y-4 pt-6">
          <div className="space-y-2">
            <Label htmlFor="amount">Amount *</Label>
            <Input
              id="amount"
              type="number"
              min="0.01"
              step="0.01"
              inputMode="decimal"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="0.00"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="saleId">Link to sale (optional)</Label>
            <select
              id="saleId"
              value={saleId}
              onChange={(e) => setSaleId(e.target.value)}
              className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm"
            >
              <option value="">None</option>
              {salesQuery.data?.map((sale) => (
                <option key={sale.id} value={sale.id}>
                  {sale.id} — {formatSignedRupees(sale.total)} ({new Date(sale.date).toLocaleDateString()})
                </option>
              ))}
            </select>
            <p className="text-xs text-muted-foreground">
              Optionally link this payment to a specific credit sale.
            </p>
          </div>

          {error && (
            <p className="text-sm text-destructive">{error}</p>
          )}

          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={() => router.push(`/customers/${customerId}`)}>Cancel</Button>
            <Button type="button" onClick={() => mutation.mutate()} disabled={mutation.isPending || !amount}>
              {mutation.isPending ? "Receiving…" : "Receive payment"}
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
