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

export interface CartLine {
  productId: string;
  name: string;
  unit: string;
  pricePerUnit: number; // rupees, from the products wire payload
  qty: number;
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

  addItem: ({ productId, name, unit, pricePerUnit }) =>
    set((state) => {
      const existing = state.items.find((line) => line.productId === productId);
      if (existing) {
        return {
          items: state.items.map((line) =>
            line.productId === productId ? { ...line, qty: line.qty + 1 } : line
          ),
        };
      }
      return {
        items: [...state.items, { productId, name, unit, pricePerUnit, qty: 1 }],
      };
    }),

  setQuantity: (productId, qty) =>
    set((state) => ({
      items:
        qty <= 0
          ? state.items.filter((line) => line.productId !== productId)
          : state.items.map((line) =>
              line.productId === productId ? { ...line, qty } : line
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
