"use client";

import { Banknote, Loader2, Minus, Plus, Smartphone, Users } from "lucide-react";
import { useRef, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { CustomerPicker } from "@/components/sales/customer-picker";
import { Button } from "@/components/ui/button";
import { api, ApiError } from "@/lib/api/client";
import { queryKeys } from "@/lib/api/query-keys";
import { MAX_ITEM_QUANTITY } from "@/lib/bounds";
import { formatRupees } from "@/lib/format/money";
import { activeTier, tierHint } from "@/lib/format/tiers";
import { hasAtMostTwoDecimals } from "@/lib/quantity";
import { cn } from "@/lib/utils";
import { newSaleSchema, type NewSalePayload } from "@/lib/validate/sale";
import type { SaleApi } from "@/modules/sales/sale.mapper";
import type { PaymentType } from "@/modules/sales/sale.types";
import { useCart, type CartLine, quantityStep, roundQuantity } from "@/stores/cart";

const PAYMENT_OPTIONS: readonly { value: PaymentType; label: string; icon: typeof Banknote }[] = [
  { value: "CASH", label: "Cash", icon: Banknote },
  { value: "ECASH", label: "E-Cash", icon: Smartphone },
  { value: "CREDIT", label: "Credit", icon: Users },
];

// One cart line: − / editable qty / + steppers. The quantity input commits on
// blur/Enter so a mid-edit value never yanks the line away. Steppers move by
// the product's step (whole units for pcs, 0.25 for measurable, D25) and cap
// at the product's stock (preview only; the server 409s on a concurrent
// shortfall, plan §12.1).
function CartLineRow({ line }: { line: CartLine }) {
  const setQuantity = useCart((state) => state.setQuantity);
  const [draft, setDraft] = useState(String(line.qty));

  const step = quantityStep(line.unit);

  // Re-sync the draft when the quantity changes from outside (steppers) while
  // letting free typing proceed unmolested — React's render-phase adjust.
  const [syncedQty, setSyncedQty] = useState(line.qty);
  if (syncedQty !== line.qty) {
    setSyncedQty(line.qty);
    setDraft(String(line.qty));
  }

  const lineTotal = line.pricePerUnit * line.qty;
  const tier = activeTier(line.tiers ?? [], line.qty);
  const maxQty = line.stockQty && line.stockQty > 0 ? line.stockQty : MAX_ITEM_QUANTITY;

  function commit(value: string) {
    const raw = value.trim();
    if (raw === "") {
      setDraft(String(line.qty));
      return;
    }
    const parsed = Number(raw);
    // D25.2: up to 2 decimal places; pcs products are handled at the server.
    if (!hasAtMostTwoDecimals(parsed) || parsed <= 0) {
      setDraft(String(line.qty));
      return;
    }
    const next = roundQuantity(Math.min(parsed, maxQty));
    setQuantity(line.productId, next);
    setDraft(String(next));
  }

  return (
    <li className="flex items-center gap-3 rounded-xl border bg-card px-3 py-3">
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium">{line.name}</p>
        <p className="text-xs text-muted-foreground tabular-nums">
          {formatRupees(line.pricePerUnit)} × {line.qty} = {formatRupees(lineTotal)}
        </p>
        {tier ? <p className="text-xs font-medium text-primary">{tierHint(tier)}</p> : null}
      </div>
      <div className="flex shrink-0 items-center gap-1">
        <Button
          variant="outline"
          size="icon"
          className="size-11"
          aria-label={
            line.qty <= step
              ? `Remove ${line.name} from cart`
              : `Decrease ${line.name} quantity`
          }
          onClick={() => setQuantity(line.productId, roundQuantity(line.qty - step))}
        >
          <Minus aria-hidden />
        </Button>
        <input
          value={draft}
          onChange={(event) => {
            const value = event.target.value;
            // Up to 4 integer digits + up to 2 decimals (1000.00, D25.8).
            if (!/^\d{0,4}(\.\d{0,2})?$/.test(value)) return;
            setDraft(value);
          }}
          onBlur={() => commit(draft)}
          onKeyDown={(event) => {
            if (event.key === "Enter") event.currentTarget.blur();
          }}
          inputMode="decimal"
          aria-label={`Quantity of ${line.name}`}
          className="h-11 w-14 rounded-lg border border-input bg-transparent text-center text-sm tabular-nums outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
        />
        <Button
          variant="outline"
          size="icon"
          className="size-11"
          aria-label={`Increase ${line.name} quantity`}
          onClick={() =>
            setQuantity(
              line.productId,
              Math.min(roundQuantity(line.qty + step), maxQty)
            )
          }
          disabled={line.qty >= maxQty}
        >
          <Plus aria-hidden />
        </Button>
      </div>
    </li>
  );
}

// The cart, payment selector, optional CREDIT customer picker, running total
// and save. The preview total is qty × listed price; the server recomputes the
// authoritative total (tier pricing, D1) and rejects over-sales (D22.2).
export function CartPanel({ onSuccess }: { onSuccess?: () => void }) {
  const queryClient = useQueryClient();
  const items = useCart((state) => state.items);
  const paymentType = useCart((state) => state.paymentType);
  const customerId = useCart((state) => state.customerId);
  const setPaymentType = useCart((state) => state.setPaymentType);
  const setCustomerId = useCart((state) => state.setCustomerId);

  const [serverError, setServerError] = useState<string | null>(null);
  const submittingRef = useRef(false);

  const total = items.reduce((sum, line) => sum + line.pricePerUnit * line.qty, 0);
  const cartEmpty = items.length === 0;
  const needsCustomer = paymentType === "CREDIT" && !customerId;
  const canSave = !cartEmpty && !needsCustomer;

  const mutation = useMutation({
    mutationFn: (payload: NewSalePayload) => api.post<SaleApi>("/api/sales", payload),
    onSuccess: (sale) => {
      toast.success(`Sale saved ${formatRupees(sale.total)}`);
      setServerError(null);
      useCart.getState().reset();
      // A sale changes stock, the sales list, and wallet/report totals.
      queryClient.invalidateQueries({ queryKey: queryKeys.products.all });
      queryClient.invalidateQueries({ queryKey: queryKeys.sales.all });
      queryClient.invalidateQueries({ queryKey: queryKeys.reports.all });
      onSuccess?.();
    },
    onError: (error) => {
      setServerError(
        error instanceof ApiError
          ? error.message
          : "Could not save the sale. Please try again."
      );
    },
  });

  const isSubmitting = mutation.isPending;

  function handleSave() {
    // Double-submit guard: the mutation's isPending only lands on the next
    // render, so a same-tick double tap is blocked here (plan §12.1).
    if (submittingRef.current || !canSave) return;

    // D25.1 fast feedback mirror of the server rule: pcs products are whole
    // units only. The backend stays authoritative.
    const fractionalPcs = items.find(
      (line) => line.unit === "pcs" && line.qty % 1 !== 0
    );
    if (fractionalPcs) {
      setServerError(
        `${fractionalPcs.name} is sold per piece — quantity must be a whole number.`
      );
      return;
    }

    const parsed = newSaleSchema.safeParse({
      paymentType,
      customerId: paymentType === "CREDIT" ? customerId : undefined,
      items: items.map((line) => ({ productId: line.productId, quantity: line.qty })),
    });

    if (!parsed.success) {
      setServerError("The cart is not ready to save yet.");
      return;
    }

    submittingRef.current = true;
    mutation.mutate(parsed.data, {
      onSettled: () => {
        submittingRef.current = false;
      },
    });
  }

  return (
    <div className="flex flex-col gap-5">
      {serverError ? (
        <p
          role="alert"
          data-testid="sale-error"
          className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive"
        >
          {serverError}
        </p>
      ) : null}

      {cartEmpty ? (
        <p className="rounded-xl border border-dashed bg-card px-3 py-6 text-center text-sm text-muted-foreground">
          Cart is empty — tap a product to add it.
        </p>
      ) : (
        <ul className="space-y-2">
          {items.map((line) => (
            <CartLineRow key={line.productId} line={line} />
          ))}
        </ul>
      )}

      <div>
        <p className="text-sm font-medium">Payment</p>
        <div className="mt-2 grid grid-cols-3 gap-2" role="group" aria-label="Payment type">
          {PAYMENT_OPTIONS.map(({ value, label, icon: Icon }) => {
            const selected = paymentType === value;
            return (
              <button
                key={value}
                type="button"
                aria-pressed={selected}
                onClick={() => {
                  setPaymentType(value);
                  setServerError(null);
                }}
                className={cn(
                  "flex min-h-[44px] flex-col items-center justify-center gap-0.5 rounded-lg border text-xs font-medium transition-colors",
                  selected
                    ? "border-primary bg-primary text-primary-foreground"
                    : "border-border bg-card text-muted-foreground hover:bg-muted hover:text-foreground"
                )}
              >
                <Icon className="size-4" aria-hidden />
                {label}
              </button>
            );
          })}
        </div>
      </div>

      {paymentType === "CREDIT" ? (
        <CustomerPicker value={customerId} onChange={setCustomerId} />
      ) : null}

      <div className="border-t pt-4">
        <div className="flex items-end justify-between">
          <span className="text-sm text-muted-foreground">Total</span>
          <span data-testid="cart-total" className="text-2xl font-semibold tabular-nums" aria-live="polite">
            {formatRupees(total)}
          </span>
        </div>
        <p className="mt-2 text-xs text-muted-foreground">
          The shop server confirms the final total and stock when you save.
        </p>
      </div>

      {needsCustomer ? (
        <p className="text-xs font-medium text-destructive">Select a customer for credit sales.</p>
      ) : null}

      <Button
        type="button"
        size="lg"
        className="h-14 w-full text-base"
        onClick={handleSave}
        disabled={isSubmitting || !canSave}
        data-testid="save-sale"
      >
        {isSubmitting ? (
          <>
            <Loader2 className="size-4 animate-spin" aria-hidden />
            Saving…
          </>
        ) : (
          "Save sale"
        )}
      </Button>
    </div>
  );
}
