"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useMutation, useQueryClient } from "@tanstack/react-query";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { api, ApiError } from "@/lib/api/client";
import { queryKeys } from "@/lib/api/query-keys";
import { toast } from "sonner";
import type { Supplier } from "@/modules/suppliers/supplier.types";

export function SupplierForm() {
  const router = useRouter();
  const queryClient = useQueryClient();

  const [name, setName] = useState("");
  const [contact, setContact] = useState("");
  const [openingBalance, setOpeningBalance] = useState("");
  const [error, setError] = useState<string | null>(null);

  const mutation = useMutation({
    mutationFn: async () => {
      const body: { name: string; contact?: string; openingBalance?: number } = {
        name: name.trim(),
      };
      if (contact.trim()) body.contact = contact.trim();
      if (openingBalance.trim()) {
        const parsed = parseFloat(openingBalance);
        if (Number.isNaN(parsed)) throw new ApiError(400, "Opening balance must be a valid number");
        body.openingBalance = parsed;
      }

      if (!body.name) throw new ApiError(400, "Name is required");

      return api.post<Supplier>("/api/suppliers", body);
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.suppliers.all });
      toast.success("Supplier created");
      router.push("/suppliers");
    },
    onError: (err: ApiError) => {
      setError(err.message);
    },
  });

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base">New supplier</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="name">Name *</Label>
          <Input id="name" value={name} onChange={(e) => setName(e.target.value)} />
        </div>

        <div className="space-y-2">
          <Label htmlFor="contact">Contact</Label>
          <Input id="contact" value={contact} onChange={(e) => setContact(e.target.value)} inputMode="tel" placeholder="Phone or note" />
        </div>

        <div className="space-y-2">
          <Label htmlFor="openingBalance">Opening balance (Rs)</Label>
          <Input
            id="openingBalance"
            type="number"
            step="0.01"
            inputMode="decimal"
            value={openingBalance}
            onChange={(e) => setOpeningBalance(e.target.value)}
            placeholder="0.00"
          />
          <p className="text-xs text-muted-foreground">
            Historical balance at ERP go-live. Positive = shop already owes this supplier.
            Negative = shop has prepaid this supplier.
          </p>
        </div>

        {error && (
          <p className="text-sm text-destructive">{error}</p>
        )}

        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={() => router.push("/suppliers")}>Cancel</Button>
          <Button type="button" onClick={() => mutation.mutate()} disabled={mutation.isPending}>
            {mutation.isPending ? "Creating…" : "Create supplier"}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
