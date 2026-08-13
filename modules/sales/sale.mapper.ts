import type { Prisma } from "../../generated/prisma/client";

import type { Sale, SaleItem } from "./sale.types";

type SaleWithItems = Prisma.SaleGetPayload<{
  include: { items: true };
}>;

export function toSaleItem(
  raw: SaleWithItems["items"][number]
): SaleItem {
  return {
    id: raw.id,
    saleId: raw.saleId,
    productId: raw.productId,
    qty: raw.qty,
    pricePerUnit: raw.pricePerUnit.toNumber(),
  };
}

export function toSale(raw: SaleWithItems): Sale {
  return {
    id: raw.id,
    customerId: raw.customerId,
    paymentType: raw.paymentType,
    total: raw.total.toNumber(),
    date: raw.date,
    items: raw.items.map(toSaleItem),
  };
}