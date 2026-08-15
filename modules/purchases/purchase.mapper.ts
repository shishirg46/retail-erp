import type { Prisma } from "../../generated/prisma/client";
import { paisaFromDecimal, paisaToRupees } from "../../lib/money";
import type { VoidStatusLabel, VoidStatusOutput } from "../voids/void.types";

import type { Purchase, PurchaseItem } from "./purchase.types";

type PurchaseWithItems = Prisma.PurchaseGetPayload<{
  include: { items: true };
}>;

export function toPurchaseItem(
  raw: PurchaseWithItems["items"][number]
): PurchaseItem {
  return {
    id: raw.id,
    purchaseId: raw.purchaseId,
    productId: raw.productId,
    qty: raw.qty,
    costPerUnit: paisaFromDecimal(raw.costPerUnit),
  };
}

export function toPurchase(raw: PurchaseWithItems): Purchase {
  return {
    id: raw.id,
    supplierId: raw.supplierId,
    paymentType: raw.paymentType,
    total: paisaFromDecimal(raw.total),
    date: raw.date,
    items: raw.items.map(toPurchaseItem),
    voidInfo: { voidedAt: null, reason: null },
  };
}

// API output view: whole-paisa domain -> rupee wire representation (D11),
// plus the computed void status (D18.9).
export type PurchaseApi = Purchase & VoidStatusOutput;

export function toPurchaseApi(purchase: Purchase): PurchaseApi {
  return {
    ...purchase,
    total: paisaToRupees(purchase.total),
    items: purchase.items.map((item) => ({
      ...item,
      costPerUnit: paisaToRupees(item.costPerUnit),
    })),
    status: (purchase.voidInfo.voidedAt ? "VOIDED" : "ACTIVE") as VoidStatusLabel,
    voidedAt: purchase.voidInfo.voidedAt,
    voidReason: purchase.voidInfo.reason,
  };
}