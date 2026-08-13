import type { Prisma } from "../../generated/prisma/client";

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
    costPerUnit: raw.costPerUnit.toNumber(),
  };
}

export function toPurchase(raw: PurchaseWithItems): Purchase {
  return {
    id: raw.id,
    supplierId: raw.supplierId,
    paymentType: raw.paymentType,
    total: raw.total.toNumber(),
    date: raw.date,
    items: raw.items.map(toPurchaseItem),
  };
}