"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { api, ApiError } from "@/lib/api/client";
import { queryKeys } from "@/lib/api/query-keys";
import { SUPPORTED_UNITS, type Unit } from "@/lib/quantity";
import { toast } from "sonner";

interface PriceTierInput {
  minQty: string;
  price: string;
}

export function ProductForm({ role }: { role: string }) {
  const router = useRouter();
  const queryClient = useQueryClient();

  const [name, setName] = useState("");
  const [unit, setUnit] = useState<Unit>("pcs");
  const [costPrice, setCostPrice] = useState("");
  const [currentPrice, setCurrentPrice] = useState("");
  const [category, setCategory] = useState("");
  const [tiers, setTiers] = useState<PriceTierInput[]>([{ minQty: "", price: "" }]);
  const [error, setError] = useState<string | null>(null);

  const mutation = useMutation({
    mutationFn: async () => {
      const body = {
        name: name.trim(),
        unit,
        costPrice: parseFloat(costPrice),
        currentPrice: parseFloat(currentPrice),
        category: category.trim() || undefined,
        priceTiers: tiers
          .filter((t) => t.minQty && t.price)
          .map((t) => ({
            minQty: parseFloat(t.minQty),
            price: parseFloat(t.price),
          })) as Array<{ minQty: number; price: number }>,
      };

      if (!body.name) throw new ApiError(400, "Name is required");
      if (unit === "pcs" && tiers.some((t) => t.minQty && parseFloat(t.minQty) % 1 !== 0)) {
        throw new ApiError(400, "pcs products cannot have fractional minQty");
      }

      return api.post("/api/products", body);
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.products.all });
      toast.success("Product created");
      router.push("/products");
    },
    onError: (err: ApiError) => {
      setError(err.message);
    },
  });

  function updateTier(index: number, field: keyof PriceTierInput, value: string) {
    setTiers((prev) => {
      const next = [...prev];
      next[index] = { ...next[index], [field]: value };
      return next;
    });
  }

  function addTier() {
    setTiers((prev) => [...prev, { minQty: "", price: "" }]);
  }

  function removeTier(index: number) {
    setTiers((prev) => prev.filter((_, i) => i !== index));
  }

  if (role !== "OWNER") {
    return (
      <Card>
        <CardContent className="p-6 text-center text-sm text-muted-foreground">
          Only owners can create products.
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base">New product</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="name">Name *</Label>
          <Input id="name" value={name} onChange={(e) => setName(e.target.value)} />
        </div>

        <div className="space-y-2">
          <Label htmlFor="unit">Unit *</Label>
          <select
            id="unit"
            value={unit}
            onChange={(e) => setUnit(e.target.value as Unit)}
            className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm"
          >
            {SUPPORTED_UNITS.map((u) => (
              <option key={u} value={u}>{u}</option>
            ))}
          </select>
        </div>

        <div className="space-y-2">
          <Label htmlFor="costPrice">Cost price *</Label>
          <Input
            id="costPrice"
            type="number"
            min="0"
            step="0.01"
            value={costPrice}
            onChange={(e) => setCostPrice(e.target.value)}
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="currentPrice">Current price *</Label>
          <Input
            id="currentPrice"
            type="number"
            min="0"
            step="0.01"
            value={currentPrice}
            onChange={(e) => setCurrentPrice(e.target.value)}
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="category">Category</Label>
          <Input id="category" value={category} onChange={(e) => setCategory(e.target.value)} />
        </div>

        <Separator />

        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <Label>Price tiers</Label>
            <Button type="button" variant="outline" size="sm" onClick={addTier}>Add tier</Button>
          </div>
          {tiers.map((tier, i) => (
            <div key={i} className="flex gap-2">
              <Input
                placeholder="Min qty"
                type="number"
                min="0"
                step={unit === "pcs" ? "1" : "0.01"}
                value={tier.minQty}
                onChange={(e) => updateTier(i, "minQty", e.target.value)}
                className="flex-1"
              />
              <Input
                placeholder="Price"
                type="number"
                min="0"
                step="0.01"
                value={tier.price}
                onChange={(e) => updateTier(i, "price", e.target.value)}
                className="flex-1"
              />
              {tiers.length > 1 && (
                <Button type="button" variant="ghost" size="sm" onClick={() => removeTier(i)}>×</Button>
              )}
            </div>
          ))}
        </div>

        {error && (
          <p className="text-sm text-destructive">{error}</p>
        )}

        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={() => router.push("/products")}>Cancel</Button>
          <Button type="button" onClick={() => mutation.mutate()} disabled={mutation.isPending}>
            {mutation.isPending ? "Creating…" : "Create product"}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
