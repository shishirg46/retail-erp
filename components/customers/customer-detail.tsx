"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { api } from "@/lib/api/client";
import { queryKeys } from "@/lib/api/query-keys";
import { formatSignedRupees } from "@/lib/format/money";
import type { Customer } from "@/modules/customers/customer.types";
import { PaymentHistory } from "./payment-history";

export function CustomerDetail({ id, role }: { id: string; role: string }) {
  const query = useQuery({
    queryKey: queryKeys.customers.detail(id),
    queryFn: () => api.get<Customer>(`/api/customers/${id}`),
  });

  if (query.isPending) {
    return <p className="text-sm text-muted-foreground">Loading customer…</p>;
  }

  if (query.isError) {
    return (
      <Card>
        <CardContent className="p-4 text-sm text-destructive">
          {query.error instanceof Error ? query.error.message : "Failed to load customer."}
        </CardContent>
      </Card>
    );
  }

  const customer = query.data;

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">{customer.name}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {customer.contact && (
            <div className="flex items-center justify-between text-sm text-muted-foreground">
              <span>Contact</span>
              <span>{customer.contact}</span>
            </div>
          )}
          <div className="flex items-center justify-between text-sm">
            <span className="text-muted-foreground">Balance</span>
            <span className={`font-medium tabular-nums ${customer.balanceOwed > 0 ? "text-destructive" : customer.balanceOwed < 0 ? "text-green-600" : ""}`}>
              {formatSignedRupees(customer.balanceOwed)}
            </span>
          </div>
        </CardContent>
      </Card>

      <div className="flex gap-2">
        <Link href={`/customers/${id}/pay`} className="flex-1">
          <Button type="button" variant="outline" className="w-full">Receive payment</Button>
        </Link>
        <Link href={`/sales/new?paymentType=CREDIT&customerId=${id}`} className="flex-1">
          <Button type="button" variant="outline" className="w-full">Sale</Button>
        </Link>
      </div>

      <PaymentHistory customerId={id} role={role} />

      <div className="flex justify-end">
        <Link href="/customers">
          <Button type="button" variant="outline">Back to customers</Button>
        </Link>
      </div>
    </div>
  );
}
