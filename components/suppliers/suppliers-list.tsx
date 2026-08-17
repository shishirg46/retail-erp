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
import { OWNER } from "@/lib/auth/roles";
import type { Supplier } from "@/modules/suppliers/supplier.types";

const PAGE_SIZE = "10";

function asSupplierPage(data: unknown): { suppliers: Supplier[]; paging: { next: string | null; hasMore: boolean } } {
  if (data && typeof data === "object" && "data" in data && Array.isArray((data as { data: unknown }).data)) {
    const paginated = data as Paginated<Supplier>;
    return { suppliers: paginated.data, paging: paginated.paging };
  }
  return {
    suppliers: Array.isArray(data) ? (data as Supplier[]) : [],
    paging: { next: null, hasMore: false },
  };
}

export function SuppliersList({ role }: { role: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const search = searchParams.get("search") ?? "";
  const cursor = searchParams.get("cursor") ?? undefined;

  const [searchInput, setSearchInput] = useState(search);

  const query = useQuery({
    queryKey: queryKeys.suppliers.list(search || undefined, cursor),
    queryFn: async () =>
      api.get<Paginated<Supplier> | Supplier[]>("/api/suppliers", {
        limit: PAGE_SIZE,
        search: search || undefined,
        cursor: cursor || undefined,
      }),
  });

  const { suppliers, paging } = useMemo(() => asSupplierPage(query.data), [query.data]);

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
    return <p className="text-sm text-muted-foreground">Loading suppliers…</p>;
  }

  if (query.isError) {
    return (
      <Card>
        <CardContent className="p-4 text-sm text-destructive">
          {query.error instanceof Error ? query.error.message : "Failed to load suppliers."}
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
          placeholder="Search suppliers…"
          className="flex-1"
        />
        <Button type="button" variant="outline" onClick={applySearch}>Search</Button>
      </div>

      {suppliers.length === 0 ? (
        <Card>
          <CardContent className="p-6 text-center text-sm text-muted-foreground">No suppliers found</CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {suppliers.map((supplier) => (
            <Card key={supplier.id}>
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
                <div className="flex justify-end gap-2">
                  {role === OWNER && (
                    <Link href={`/suppliers/${supplier.id}/pay`} className="inline-flex items-center">
                      <Button type="button" variant="outline" size="sm">Pay supplier</Button>
                    </Link>
                  )}
                  <Link href={`/suppliers/${supplier.id}`} className="inline-flex items-center" aria-label={`View ${supplier.name}`}>
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

      {role === OWNER && (
        <div className="flex justify-end">
          <Link href="/suppliers/new">
            <Button type="button">New supplier</Button>
          </Link>
        </div>
      )}
    </div>
  );
}
