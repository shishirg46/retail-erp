"use client";

import { Loader2, Search, UserPlus } from "lucide-react";
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { api, ApiError } from "@/lib/api/client";
import { queryKeys } from "@/lib/api/query-keys";
import type { Paginated } from "@/lib/api/types";
import { formatSignedRupees } from "@/lib/format/money";
import { cn } from "@/lib/utils";
import type { Customer } from "@/modules/customers/customer.types";

// Inline "add a new credit customer" form (plan §12.1). Creates through the
// existing POST /api/customers (OWNER + CASHIER, D9.3) and hands the created
// customer straight back to the picker so the credit sale can proceed.
function NewCustomerForm({
  initialName,
  onCreated,
  onCancel,
}: {
  initialName: string;
  onCreated: (customer: Customer) => void;
  onCancel: () => void;
}) {
  const queryClient = useQueryClient();
  const [name, setName] = useState(initialName);
  const [contact, setContact] = useState("");
  const [error, setError] = useState<string | null>(null);

  const createCustomer = useMutation({
    mutationFn: (payload: { name: string; contact?: string }) =>
      api.post<Customer>("/api/customers", payload),
    onSuccess: (customer) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.customers.all });
      onCreated(customer);
    },
    onError: (err) => {
      setError(
        err instanceof ApiError
          ? err.message
          : "Could not create the customer. Please try again."
      );
    },
  });

  function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    if (name.trim().length === 0) {
      setError("Enter the customer's name.");
      return;
    }
    createCustomer.mutate({
      name: name.trim(),
      contact: contact.trim() || undefined,
    });
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="space-y-3 rounded-xl border bg-card p-3"
      aria-label="Add a new customer"
    >
      <div className="space-y-1.5">
        <label htmlFor="new-customer-name" className="text-xs font-medium text-muted-foreground">
          Name
        </label>
        <Input
          id="new-customer-name"
          value={name}
          onChange={(event) => setName(event.target.value)}
          placeholder="Customer name"
          aria-label="New customer name"
          className="h-11 text-base"
          autoFocus
        />
      </div>

      <div className="space-y-1.5">
        <label htmlFor="new-customer-contact" className="text-xs font-medium text-muted-foreground">
          Contact (optional)
        </label>
        <Input
          id="new-customer-contact"
          value={contact}
          onChange={(event) => setContact(event.target.value)}
          placeholder="Phone or note"
          aria-label="New customer contact"
          className="h-11 text-base"
          inputMode="tel"
        />
      </div>

      {error ? (
        <p
          role="alert"
          className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive"
        >
          {error}
        </p>
      ) : null}

      <div className="flex gap-2">
        <Button type="submit" size="lg" className="h-11 flex-1" disabled={createCustomer.isPending}>
          {createCustomer.isPending ? (
            <>
              <Loader2 className="size-4 animate-spin" aria-hidden />
              Creating…
            </>
          ) : (
            "Create customer"
          )}
        </Button>
        <Button
          type="button"
          variant="outline"
          size="lg"
          className="h-11"
          onClick={onCancel}
          disabled={createCustomer.isPending}
        >
          Cancel
        </Button>
      </div>
    </form>
  );
}

// CREDIT customer picker (plan §12.1). Shown only when the payment type is
// CREDIT; the picker is mandatory because the backend 400s on a missing
// customer. Balance is signed (D4): negative = prepaid credit. You can pick an
// existing customer or add a brand-new one on the spot.
export function CustomerPicker({
  value,
  onChange,
}: {
  value: string | null;
  onChange: (customerId: string | null) => void;
}) {
  const [search, setSearch] = useState("");
  const [creating, setCreating] = useState(false);
  const [localSelected, setLocalSelected] = useState<Customer | null>(null);

  const customers = useQuery({
    queryKey: queryKeys.customers.list(search),
    queryFn: async () => {
      const res = await api.get<Paginated<Customer>>("/api/customers", {
        search: search || undefined,
        limit: "50",
      });
      return res.data;
    },
  });

  // Prefer the fresh copy from the list (current balance); fall back to the
  // local pick so a just-created customer shows immediately before the
  // refetch lands.
  const selected =
    (value && customers.data?.find((customer) => customer.id === value)) ||
    (value && localSelected && localSelected.id === value ? localSelected : null);

  function pick(customer: Customer) {
    setLocalSelected(customer);
    onChange(customer.id);
  }

  function handleCreated(customer: Customer) {
    setCreating(false);
    setSearch("");
    pick(customer);
  }

  return (
    <div className="space-y-2">
      <p className="text-sm font-medium">Customer</p>

      {selected ? (
        <div className="flex items-center justify-between gap-3 rounded-xl border bg-card px-3 py-2">
          <div className="min-w-0">
            <p className="truncate text-sm font-medium">{selected.name}</p>
            <p className="text-xs text-muted-foreground tabular-nums">
              Balance {formatSignedRupees(selected.balanceOwed)}
            </p>
          </div>
          <Button variant="ghost" size="sm" className="h-11 shrink-0" onClick={() => onChange(null)}>
            Change
          </Button>
        </div>
      ) : creating ? (
        <NewCustomerForm
          initialName={search}
          onCreated={handleCreated}
          onCancel={() => setCreating(false)}
        />
      ) : (
        <>
          <div className="relative">
            <Search
              className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
              aria-hidden
            />
            <Input
              type="search"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search customers…"
              aria-label="Search customers"
              className="h-11 pl-9 text-base"
            />
          </div>
          <ul className="max-h-52 overflow-y-auto rounded-xl border border-border bg-card">
            {customers.isPending ? (
              <li className="px-3 py-3 text-sm text-muted-foreground">Loading customers…</li>
            ) : null}
            {customers.isError ? (
              <li className="px-3 py-3 text-sm text-destructive">Couldn&apos;t load customers.</li>
            ) : null}
            {customers.isSuccess && customers.data.length === 0 ? (
              <li className="px-3 py-3 text-sm text-muted-foreground">
                No customers found — add one below.
              </li>
            ) : null}
            {customers.isSuccess
              ? customers.data.map((customer) => (
                  <li key={customer.id} className="border-b border-border last:border-b-0">
                    <button
                      type="button"
                      onClick={() => pick(customer)}
                      className={cn(
                        "flex min-h-[44px] w-full items-center justify-between gap-3 px-3 py-2 text-left",
                        "hover:bg-muted focus-visible:bg-muted focus-visible:outline-none"
                      )}
                    >
                      <span className="truncate text-sm font-medium">{customer.name}</span>
                      <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
                        {formatSignedRupees(customer.balanceOwed)}
                      </span>
                    </button>
                  </li>
                ))
              : null}
          </ul>
          <Button type="button" variant="outline" className="h-11 w-full" onClick={() => setCreating(true)}>
            <UserPlus className="size-4" aria-hidden />
            New customer
          </Button>
        </>
      )}
    </div>
  );
}
