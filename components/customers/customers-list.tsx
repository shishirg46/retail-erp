"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { api } from "@/lib/api/client";
import type { Paginated } from "@/lib/api/types";
import { queryKeys } from "@/lib/api/query-keys";
import { formatSignedRupees } from "@/lib/format/money";
import type { Customer } from "@/modules/customers/customer.types";

const PAGE_SIZE = "10";

function asCustomerPage(data: unknown): { customers: Customer[]; paging: { next: string | null; hasMore: boolean } } {
  if (data && typeof data === "object" && "data" in data && Array.isArray((data as { data: unknown }).data)) {
    const paginated = data as Paginated<Customer>;
    return { customers: paginated.data, paging: paginated.paging };
  }
  return {
    customers: Array.isArray(data) ? (data as Customer[]) : [],
    paging: { next: null, hasMore: false },
  };
}

export function CustomersList() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const search = searchParams.get("search") ?? "";
  const cursor = searchParams.get("cursor") ?? undefined;

  const [searchInput, setSearchInput] = useState(search);

  const query = useQuery({
    queryKey: queryKeys.customers.list(search || undefined, cursor),
    queryFn: async () =>
      api.get<Paginated<Customer> | Customer[]>("/api/customers", {
        limit: PAGE_SIZE,
        search: search || undefined,
        cursor: cursor || undefined,
      }),
  });

  const { customers, paging } = useMemo(() => asCustomerPage(query.data), [query.data]);

  function applySearch() {
    const params = new URLSearchParams(searchParams.toString());
    if (searchInput.trim()) params.set("search", searchInput.trim());
    else params.delete("search");
    params.delete("cursor");
    params.set("limit", PAGE_SIZE);
    router.replace(`${pathname}?${params.toString()}`, { scroll: false });
  }

  function setPage(nextCursor: string | null) {
    const params = new URLSearchParams(searchParams.toString());
    if (nextCursor) params.set("cursor", nextCursor);
    else params.delete("cursor");
    router.replace(`${pathname}?${params.toString()}`, { scroll: false });
  }

  if (query.isPending) {
    return <p className="text-sm text-muted-foreground">Loading customers…</p>;
  }

  if (query.isError) {
    return (
      <Card>
        <CardContent className="p-4 text-sm text-destructive">
          {query.error instanceof Error ? query.error.message : "Failed to load customers."}
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex gap-2">
        <Input
          value={searchInput}
          onChange={(e) => setSearchInput(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") applySearch(); }}
          placeholder="Search customers…"
          className="flex-1"
        />
        <Button type="button" variant="outline" onClick={applySearch}>Search</Button>
      </div>

      {customers.length === 0 ? (
        <Card>
          <CardContent className="p-6 text-center text-sm text-muted-foreground">No customers found</CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {customers.map((customer) => (
            <Card key={customer.id}>
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
                <div className="flex justify-end gap-2">
                  <Link href={`/customers/${customer.id}/pay`} className="inline-flex items-center">
                    <Button type="button" variant="outline" size="sm">Receive payment</Button>
                  </Link>
                  <Link href={`/customers/${customer.id}`} className="inline-flex items-center" aria-label={`View ${customer.name}`}>
                    <Button type="button" variant="outline" size="sm">View</Button>
                  </Link>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <div className="flex justify-between gap-2">
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={!cursor}
          onClick={() => setPage(null)}
        >
          Previous
        </Button>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={!paging.hasMore}
          onClick={() => setPage(paging.next)}
        >
          Next page
        </Button>
      </div>

      <div className="flex justify-end">
        <Link href="/customers/new">
          <Button type="button">New customer</Button>
        </Link>
      </div>
    </div>
  );
}
