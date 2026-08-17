"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { api, ApiError } from "@/lib/api/client";
import { queryKeys } from "@/lib/api/query-keys";
import { formatRupees } from "@/lib/format/money";
import { toast } from "sonner";
import { ProductSelector, type ProductOption } from "./product-selector";
import { PurchaseItemRow, type PurchaseItemData } from "./purchase-item-row";

interface SupplierOption {
  id: string;
  name: string;
}

export function PurchaseForm() {
  const router = useRouter();
  const queryClient = useQueryClient();

  const [supplierId, setSupplierId] = useState("");
  const [paymentType, setPaymentType] = useState<"CASH" | "CREDIT">("CASH");
  const [items, setItems] = useState<PurchaseItemData[]>([]);
  const [showProductSelector, setShowProductSelector] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const suppliersQuery = useQuery({
    queryKey: queryKeys.suppliers.all,
    queryFn: () => api.get<SupplierOption[]>("/api/suppliers"),
  });

  const suppliers = suppliersQuery.data ?? [];

  const grandTotal = useMemo(
    () => items.reduce((sum, item) => sum + item.quantity * item.costPerUnit, 0),
    [items],
  );

  function addProduct(product: ProductOption) {
    setItems((prev) => [
      ...prev,
      {
        productId: product.id,
        productName: product.name,
        unit: product.unit,
        unitsPerPack: product.unitsPerPack,
        quantity: 1,
        costPerUnit: product.costPrice,
      },
    ]);
    setShowProductSelector(false);
  }

  function updateItem(index: number, patch: Partial<PurchaseItemData>) {
    setItems((prev) => prev.map((item, i) => (i === index ? { ...item, ...patch } : item)));
  }

  function removeItem(index: number) {
    setItems((prev) => prev.filter((_, i) => i !== index));
  }

  const mutation = useMutation({
    mutationFn: async () => {
      if (!supplierId) throw new ApiError(400, "Supplier is required");
      if (items.length === 0) throw new ApiError(400, "At least one item is required");

      for (const item of items) {
        if (item.quantity <= 0) throw new ApiError(400, `Quantity for ${item.productName} must be positive`);
        if (item.costPerUnit < 0) throw new ApiError(400, `Cost for ${item.productName} cannot be negative`);
      }

      return api.post<{ id: string }>("/api/purchases", {
        supplierId,
        paymentType,
        items: items.map((item) => ({
          productId: item.productId,
          quantity: item.quantity,
          costPerUnit: item.costPerUnit,
        })),
      });
    },
    onSuccess: async (data) => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.purchases.all });
      await queryClient.invalidateQueries({ queryKey: queryKeys.products.all });
      await queryClient.invalidateQueries({ queryKey: queryKeys.suppliers.all });
      toast.success("Purchase recorded");
      router.push(`/purchases/${data.id}`);
    },
    onError: (err: ApiError) => {
      setError(err.message);
    },
  });

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Purchase details</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label>Supplier *</Label>
            {suppliersQuery.isPending ? (
              <p className="text-sm text-muted-foreground">Loading suppliers…</p>
            ) : (
              <select
                value={supplierId}
                onChange={(e) => setSupplierId(e.target.value)}
                className="flex h-10 w-full rounded-lg border border-input bg-transparent px-3 py-2 text-sm"
              >
                <option value="">Select supplier…</option>
                {suppliers.map((s) => (
                  <option key={s.id} value={s.id}>{s.name}</option>
                ))}
              </select>
            )}
          </div>

          <div className="space-y-2">
            <Label>Payment type *</Label>
            <div className="flex gap-2">
              <Button
                type="button"
                variant={paymentType === "CASH" ? "default" : "outline"}
                onClick={() => setPaymentType("CASH")}
              >
                CASH
              </Button>
              <Button
                type="button"
                variant={paymentType === "CREDIT" ? "default" : "outline"}
                onClick={() => setPaymentType("CREDIT")}
              >
                CREDIT
              </Button>
            </div>
            {paymentType === "CREDIT" && (
              <p className="text-xs text-muted-foreground">
                CREDIT increases the supplier balance. No wallet withdrawal now.
              </p>
            )}
            {paymentType === "CASH" && (
              <p className="text-xs text-muted-foreground">
                CASH withdraws from the wallet immediately.
              </p>
            )}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Items</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {items.length > 0 ? (
            <div className="space-y-3">
              {items.map((item, i) => (
                <PurchaseItemRow key={item.productId} item={item} index={i} onChange={updateItem} onRemove={removeItem} />
              ))}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">No items added yet</p>
          )}

          {showProductSelector ? (
            <ProductSelector onSelect={addProduct} excludeIds={items.map((i) => i.productId)} />
          ) : (
            <Button type="button" variant="outline" onClick={() => setShowProductSelector(true)}>
              Add product
            </Button>
          )}

          {items.length > 0 && (
            <div className="flex items-center justify-between border-t pt-3">
              <span className="text-sm font-medium">Grand total</span>
              <span className="text-lg font-semibold tabular-nums">{formatRupees(grandTotal)}</span>
            </div>
          )}
        </CardContent>
      </Card>

      {error && (
        <Card>
          <CardContent className="p-4 text-sm text-destructive">{error}</CardContent>
        </Card>
      )}

      <div className="flex justify-end gap-2">
        <Button type="button" variant="outline" onClick={() => router.push("/purchases")}>
          Cancel
        </Button>
        <Button
          type="button"
          onClick={() => mutation.mutate()}
          disabled={mutation.isPending || !supplierId || items.length === 0}
        >
          {mutation.isPending ? "Recording…" : "Record purchase"}
        </Button>
      </div>
    </div>
  );
}
