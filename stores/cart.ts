// POS cart store (D22.2) — the single client-global Zustand store. Everything
// else is server state (TanStack Query), local useState, URL, or form state.
//
// The cart holds PREVIEW data only: prices come from the product wire shape
// (rupees) and the server recomputes the authoritative total at POST /api/sales
// (D1, D22.2). `reset` clears the lines but keeps the chosen CREDIT customer
// (plan §12.1: "screen resets to a fresh cart (keeps the customer when CREDIT)").

"use client";

import { create } from "zustand";

import type { PaymentType } from "@/modules/reports/report.types";

// The quantity step for the POS tap-to-add / steppers (D25): pcs products are
// whole units; measurable units step in quarters (0.25 kg / 250 ml ...).
export function quantityStep(unit: string): number {
  return unit === "pcs" ? 1 : 0.25;
}

// All cart arithmetic stays within 2 dp; round to absorb float noise from
// stepper increments (e.g. 1.05 + 0.25 -> 1.3).
export function roundQuantity(qty: number): number {
  return Math.round(qty * 100) / 100;
}

export interface CartLine {
  productId: string;
  name: string;
  unit: string;
  pricePerUnit: number; // rupees, from the products wire payload
  qty: number;
  // Optional POS extras (plan §12.1): stock drives the client-side quantity
  // cap; tiers drive the D1 hint. Both are preview/UX only — the server is
  // authoritative for availability and price.
  stockQty?: number;
  tiers?: readonly { minQty: number; price: number }[];
}

interface CartState {
  items: CartLine[];
  paymentType: PaymentType;
  customerId: string | null;
  addItem: (line: Omit<CartLine, "qty">) => void;
  setQuantity: (productId: string, qty: number) => void;
  removeItem: (productId: string) => void;
  setPaymentType: (paymentType: PaymentType) => void;
  setCustomerId: (customerId: string | null) => void;
  reset: () => void;
}

export const useCart = create<CartState>()((set) => ({
  items: [],
  paymentType: "CASH",
  customerId: null,

  addItem: (line) =>
    set((state) => {
      const step = quantityStep(line.unit);
      const existing = state.items.find((item) => item.productId === line.productId);
      if (existing) {
        return {
          items: state.items.map((item) =>
            item.productId === line.productId
              ? { ...item, qty: roundQuantity(item.qty + step) }
              : item
          ),
        };
      }
      return {
        items: [...state.items, { ...line, qty: step }],
      };
    }),

  setQuantity: (productId, qty) =>
    set((state) => ({
      items:
        qty <= 0
          ? state.items.filter((line) => line.productId !== productId)
          : state.items.map((line) =>
              line.productId === productId
                ? { ...line, qty: roundQuantity(qty) }
                : line
            ),
    })),

  removeItem: (productId) =>
    set((state) => ({
      items: state.items.filter((line) => line.productId !== productId),
    })),

  setPaymentType: (paymentType) => set({ paymentType }),
  setCustomerId: (customerId) => set({ customerId }),

  reset: () =>
    set((state) => ({
      items: [],
      paymentType: "CASH",
      // Keep the CREDIT customer so a follow-up CREDIT sale stays on the same
      // account (plan §12.1); CASH/ECASH never had one.
      customerId: state.paymentType === "CREDIT" ? state.customerId : null,
    })),
}));
