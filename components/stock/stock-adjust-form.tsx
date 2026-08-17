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
import { toast } from "sonner";
import type { Product } from "@/modules/products/product.types";

type ProductApi = Product & {
  costPrice: number;
  currentPrice: number;
  stockQty: number;
};

export function StockAdjustForm() {
  const router = useRouter();
  const queryClient = useQueryClient();

  const [productId, setProductId] = useState("");
  const [reason, setReason] = useState<"DAMAGE" | "CORRECTION">("DAMAGE");
  const [quantity, setQuantity] = useState("");
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);

  const productsQuery = useQuery({
    queryKey: ["products", "all"],
    queryFn: () => api.get<ProductApi[]>("/api/products"),
  });

  const products = Array.isArray(productsQuery.data)
    ? (productsQuery.data as ProductApi[])
    : [];

  const selectedProduct = products.find((p) => p.id === productId);

  const mutation = useMutation({
    mutationFn: async () => {
      const qty = parseFloat(quantity);
      if (!productId) throw new ApiError(400, "Product is required");
      if (isNaN(qty) || qty <= 0) throw new ApiError(400, "Quantity must be positive");
      if (qty > 1000) throw new ApiError(400, "Quantity cannot exceed 1000");

      return api.post("/api/stock/adjustments", {
        productId,
        reason,
        quantity: qty,
        note: note.trim() || undefined,
      });
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.stock.all });
      await queryClient.invalidateQueries({ queryKey: queryKeys.products.all });
      toast.success("Stock adjusted");
      router.push("/stock/movements");
    },
    onError: (err: ApiError) => {
      setError(err.message);
    },
  });

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base">Stock adjustment</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="product">Product *</Label>
          <select
            id="product"
            value={productId}
            onChange={(e) => setProductId(e.target.value)}
            className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm"
          >
            <option value="">Select product…</option>
            {products.map((p) => (
              <option key={p.id} value={p.id}>{p.name} ({p.unit})</option>
            ))}
          </select>
        </div>

        {selectedProduct && (
          <div className="rounded-md border p-3 text-sm">
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">Current stock</span>
              <span className="font-medium tabular-nums">{selectedProduct.stockQty} {selectedProduct.unit}</span>
            </div>
          </div>
        )}

        <div className="space-y-2">
          <Label htmlFor="reason">Reason *</Label>
          <select
            id="reason"
            value={reason}
            onChange={(e) => setReason(e.target.value as "DAMAGE" | "CORRECTION")}
            className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm"
          >
            <option value="DAMAGE">Damage — quantity removed</option>
            <option value="CORRECTION">Correction — set target stock level</option>
          </select>
        </div>

        <div className="space-y-2">
          <Label htmlFor="quantity">
            {reason === "DAMAGE" ? "Quantity damaged *" : "Target stock level *"}
          </Label>
          <Input
            id="quantity"
            type="number"
            min="0"
            step={selectedProduct?.unit === "pcs" ? "1" : "0.01"}
            max="1000"
            value={quantity}
            onChange={(e) => setQuantity(e.target.value)}
          />
          <p className="text-xs text-muted-foreground">
            {reason === "DAMAGE"
              ? "Amount of stock to remove (positive number)"
              : "Desired final stock level (0 or more)"}
          </p>
        </div>

        <div className="space-y-2">
          <Label htmlFor="note">Note</Label>
          <Input id="note" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Optional note" />
        </div>

        {error && (
          <p className="text-sm text-destructive">{error}</p>
        )}

        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={() => router.push("/stock/movements")}>Cancel</Button>
          <Button type="button" onClick={() => mutation.mutate()} disabled={mutation.isPending}>
            {mutation.isPending ? "Adjusting…" : "Adjust stock"}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
