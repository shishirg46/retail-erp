"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { api } from "@/lib/api/client";
import { queryKeys } from "@/lib/api/query-keys";
import { formatSignedRupees } from "@/lib/format/money";
import { OWNER } from "@/lib/auth/roles";
import type { Supplier } from "@/modules/suppliers/supplier.types";
import { SupplierPaymentHistory } from "./supplier-payment-history";

export function SupplierDetail({ id, role }: { id: string; role: string }) {
  const query = useQuery({
    queryKey: queryKeys.suppliers.detail(id),
    queryFn: () => api.get<Supplier>(`/api/suppliers/${id}`),
  });

  if (query.isPending) {
    return <p className="text-sm text-muted-foreground">Loading supplier…</p>;
  }

  if (query.isError) {
    return (
      <Card>
        <CardContent className="p-4 text-sm text-destructive">
          {query.error instanceof Error ? query.error.message : "Failed to load supplier."}
        </CardContent>
      </Card>
    );
  }

  const supplier = query.data;

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">{supplier.name}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {supplier.contact && (
            <div className="flex items-center justify-between text-sm text-muted-foreground">
              <span>Contact</span>
              <span>{supplier.contact}</span>
            </div>
          )}
          <div className="flex items-center justify-between text-sm">
            <span className="text-muted-foreground">Balance</span>
            <span className={`font-medium tabular-nums ${supplier.balanceOwed > 0 ? "text-destructive" : supplier.balanceOwed < 0 ? "text-green-600" : ""}`}>
              {supplier.balanceOwed > 0 && "Shop owes "}
              {supplier.balanceOwed < 0 && "Prepaid "}
              {formatSignedRupees(supplier.balanceOwed)}
            </span>
          </div>
          {supplier.openingBalance !== 0 && (
            <div className="flex items-center justify-between text-sm text-muted-foreground">
              <span>Opening balance</span>
              <span>{formatSignedRupees(supplier.openingBalance)}</span>
            </div>
          )}
        </CardContent>
      </Card>

      {role === OWNER && (
        <div className="flex gap-2">
          <Link href={`/suppliers/${id}/pay`} className="flex-1">
            <Button type="button" variant="outline" className="w-full">Pay supplier</Button>
          </Link>
        </div>
      )}

      {role === OWNER && <SupplierPaymentHistory supplierId={id} role={role} />}

      <div className="flex justify-end">
        <Link href="/suppliers">
          <Button type="button" variant="outline">Back to suppliers</Button>
        </Link>
      </div>
    </div>
  );
}
