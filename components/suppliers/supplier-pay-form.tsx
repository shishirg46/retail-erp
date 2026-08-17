"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { api, ApiError } from "@/lib/api/client";
import { queryKeys } from "@/lib/api/query-keys";
import { formatSignedRupees } from "@/lib/format/money";
import type { Supplier } from "@/modules/suppliers/supplier.types";
import { toast } from "sonner";

export function SupplierPayForm({ supplierId }: { supplierId: string }) {
  const router = useRouter();
  const queryClient = useQueryClient();

  const [amount, setAmount] = useState("");
  const [error, setError] = useState<string | null>(null);

  const supplierQuery = useQuery({
    queryKey: queryKeys.suppliers.detail(supplierId),
    queryFn: () => api.get<Supplier>(`/api/suppliers/${supplierId}`),
  });

  const mutation = useMutation({
    mutationFn: async () => {
      const parsedAmount = parseFloat(amount);
      if (Number.isNaN(parsedAmount) || parsedAmount <= 0) {
        throw new ApiError(400, "Amount must be a positive number");
      }

      return api.post("/api/supplier-payments", {
        supplierId,
        amount: parsedAmount,
      });
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.supplierPayments.all });
      await queryClient.invalidateQueries({ queryKey: queryKeys.suppliers.all });
      toast.success("Payment recorded");
      router.push(`/suppliers/${supplierId}`);
    },
    onError: (err: ApiError) => {
      setError(err.message);
    },
  });

  const supplier = supplierQuery.data;

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Pay supplier</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {supplierQuery.isPending ? (
            <p className="text-sm text-muted-foreground">Loading supplier…</p>
          ) : supplierQuery.isError ? (
            <p className="text-sm text-destructive">
              {supplierQuery.error instanceof Error ? supplierQuery.error.message : "Failed to load supplier."}
            </p>
          ) : supplier ? (
            <>
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">Supplier</span>
                <span className="font-medium">{supplier.name}</span>
              </div>
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">Current balance</span>
                <span className={`font-medium tabular-nums ${supplier.balanceOwed > 0 ? "text-destructive" : supplier.balanceOwed < 0 ? "text-green-600" : ""}`}>
                  {supplier.balanceOwed > 0 && "Shop owes "}
                  {supplier.balanceOwed < 0 && "Prepaid "}
                  {formatSignedRupees(supplier.balanceOwed)}
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

          {error && (
            <p className="text-sm text-destructive">{error}</p>
          )}

          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={() => router.push(`/suppliers/${supplierId}`)}>Cancel</Button>
            <Button type="button" onClick={() => mutation.mutate()} disabled={mutation.isPending || !amount}>
              {mutation.isPending ? "Recording…" : "Record payment"}
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
