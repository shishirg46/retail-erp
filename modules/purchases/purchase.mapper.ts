import type { Prisma } from "../../generated/prisma/client";
import { paisaFromDecimal, paisaToRupees } from "../../lib/money";
import { quantityFromDecimal, unitsToQuantity } from "../../lib/quantity";
import type { VoidStatusLabel, VoidStatusOutput } from "../voids/void.types";

import type { Purchase, PurchaseItem } from "./purchase.types";

type PurchaseItemWithProduct = Prisma.PurchaseItemGetPayload<{
  include: { product: { select: { name: true } } };
}>;

type PurchaseWithItems = Prisma.PurchaseGetPayload<{
  include: { items: { include: { product: { select: { name: true } } } } };
}>;

export function toPurchaseItem(
  raw: PurchaseItemWithProduct
): PurchaseItem {
  return {
    id: raw.id,
    purchaseId: raw.purchaseId,
    productId: raw.productId,
    productName: raw.product.name,
    qty: quantityFromDecimal(raw.qty),
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
export type PurchaseItemApi = {
  id: string;
  purchaseId: string;
  productId: string;
  productName: string;
  qty: number;
  costPerUnit: number;
};

export type PurchaseApi = {
  id: string;
  supplierId: string;
  paymentType: Purchase["paymentType"];
  total: number;
  date: Date;
  items: PurchaseItemApi[];
  voidInfo: Purchase["voidInfo"];
} & VoidStatusOutput;

export function toPurchaseApi(purchase: Purchase): PurchaseApi {
  return {
    ...purchase,
    total: paisaToRupees(purchase.total),
    items: purchase.items.map((item) => ({
      id: item.id,
      purchaseId: item.purchaseId,
      productId: item.productId,
      productName: item.productName,
      qty: unitsToQuantity(item.qty),
      costPerUnit: paisaToRupees(item.costPerUnit),
    })),
    status: (purchase.voidInfo.voidedAt ? "VOIDED" : "ACTIVE") as VoidStatusLabel,
    voidedAt: purchase.voidInfo.voidedAt,
    voidReason: purchase.voidInfo.reason,
  };
}