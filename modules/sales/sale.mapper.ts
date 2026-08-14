import type { Prisma } from "../../generated/prisma/client";
import { paisaFromDecimal, paisaToRupees } from "../../lib/money";

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
    pricePerUnit: paisaFromDecimal(raw.pricePerUnit),
  };
}

export function toSale(raw: SaleWithItems): Sale {
  return {
    id: raw.id,
    customerId: raw.customerId,
    paymentType: raw.paymentType,
    total: paisaFromDecimal(raw.total),
    date: raw.date,
    items: raw.items.map(toSaleItem),
  };
}

// API output view: whole-paisa domain -> rupee wire representation (D11).
export function toSaleApi(sale: Sale): Sale {
  return {
    ...sale,
    total: paisaToRupees(sale.total),
    items: sale.items.map((item) => ({
      ...item,
      pricePerUnit: paisaToRupees(item.pricePerUnit),
    })),
  };
}