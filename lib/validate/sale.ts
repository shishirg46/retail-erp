// New-sale form schema (D22.2) — mirrors the backend create-sale contract
// (`modules/sales/sale.validation.ts`) so the UI gives fast, inline feedback.
// The backend stays authoritative; this schema only reflects the same shapes
// and bounds (MAX_ITEM_QUANTITY / MAX_ITEMS_PER_DOCUMENT from lib/bounds.ts).

import { z } from "zod";

import { MAX_ITEM_QUANTITY, MAX_ITEMS_PER_DOCUMENT } from "../bounds";
import { hasAtMostTwoDecimals } from "../quantity";

export const PAYMENT_TYPES = ["CASH", "ECASH", "CREDIT"] as const;
export type PaymentType = (typeof PAYMENT_TYPES)[number];

export const saleItemSchema = z.object({
  productId: z.string().min(1, "Product is required"),
  quantity: z
    .number()
    .refine(
      (value) => hasAtMostTwoDecimals(value),
      "Quantity must have at most 2 decimal places"
    )
    .min(0.01, "Quantity must be at least 0.01")
    .max(MAX_ITEM_QUANTITY, `Quantity must be at most ${MAX_ITEM_QUANTITY}`),
});

export const newSaleSchema = z
  .object({
    paymentType: z.enum(PAYMENT_TYPES),
    customerId: z.string().min(1, "Customer is required for credit sales").optional(),
    items: z
      .array(saleItemSchema)
      .min(1, "Add at least one item")
      .max(MAX_ITEMS_PER_DOCUMENT, `At most ${MAX_ITEMS_PER_DOCUMENT} items per sale`),
  })
  .superRefine((value, ctx) => {
    if (value.paymentType === "CREDIT" && !value.customerId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["customerId"],
        message: "Select a customer for credit sales",
      });
    }
  });

export type NewSalePayload = z.infer<typeof newSaleSchema>;
