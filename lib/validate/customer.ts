// Client-side validation for customer and customer-payment forms (C.2).
// Mirrors the backend contracts (modules/customers/customer.validation.ts,
// modules/customer-payments/customer-payment.validation.ts) so the UI gives
// fast, inline feedback. The backend stays authoritative.

import { z } from "zod";

import { MAX_AMOUNT } from "../bounds";

export const createCustomerSchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(200, "Name must be at most 200 characters"),
  contact: z.string().trim().max(200, "Contact must be at most 200 characters").optional(),
});

export type CreateCustomerPayload = z.infer<typeof createCustomerSchema>;

export const createCustomerPaymentSchema = z.object({
  amount: z
    .number()
    .positive("Amount must be a positive number")
    .max(MAX_AMOUNT, `Amount must be at most ${MAX_AMOUNT}`),
  saleId: z.string().optional(),
});

export type CreateCustomerPaymentPayload = z.infer<typeof createCustomerPaymentSchema>;

export const voidCustomerPaymentSchema = z.object({
  reason: z.string().trim().min(1, "Reason is required").max(500, "Reason must be at most 500 characters"),
  note: z.string().trim().max(1000, "Note must be at most 1000 characters").optional(),
});

export type VoidCustomerPaymentPayload = z.infer<typeof voidCustomerPaymentSchema>;
