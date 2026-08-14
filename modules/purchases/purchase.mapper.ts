import type { Prisma } from "../../generated/prisma/client";
import { paisaFromDecimal, paisaToRupees } from "../../lib/money";

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
  };
}

// API output view: whole-paisa domain -> rupee wire representation (D11).
export function toPurchaseApi(purchase: Purchase): Purchase {
  return {
    ...purchase,
    total: paisaToRupees(purchase.total),
    items: purchase.items.map((item) => ({
      ...item,
      costPerUnit: paisaToRupees(item.costPerUnit),
    })),
  };
}