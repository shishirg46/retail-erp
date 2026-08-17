import type { Prisma } from "../../generated/prisma/client";
import { paisaFromDecimal, paisaToRupees } from "../../lib/money";
import { quantityFromDecimal, unitsToQuantity } from "../../lib/quantity";
import type { VoidStatusLabel, VoidStatusOutput } from "../voids/void.types";

import type { Sale, SaleItem } from "./sale.types";

type SaleItemWithProduct = Prisma.SaleItemGetPayload<{
  include: { product: { select: { name: true } } };
}>;

type SaleWithItems = Prisma.SaleGetPayload<{
  include: { items: { include: { product: { select: { name: true } } } } };
}>;

export function toSaleItem(
  raw: SaleItemWithProduct
): SaleItem {
  return {
    id: raw.id,
    saleId: raw.saleId,
    productId: raw.productId,
    productName: raw.product.name,
    qty: quantityFromDecimal(raw.qty),
    pricePerUnit: paisaFromDecimal(raw.pricePerUnit),
    lineTotal: paisaFromDecimal(raw.lineTotal),
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
    voidInfo: { voidedAt: null, reason: null },
  };
}

// Enriched item for the API response.
export type SaleItemApi = {
  id: string;
  saleId: string;
  productId: string;
  productName: string;
  qty: number;
  pricePerUnit: number;
  lineTotal: number;
};

export type SaleApi = {
  id: string;
  customerId: string | null;
  paymentType: Sale["paymentType"];
  total: number;
  date: Date;
  items: SaleItemApi[];
  voidInfo: Sale["voidInfo"];
} & VoidStatusOutput;

export function toSaleApi(sale: Sale): SaleApi {
  return {
    ...sale,
    total: paisaToRupees(sale.total),
    items: sale.items.map((item) => ({
      id: item.id,
      saleId: item.saleId,
      productId: item.productId,
      productName: item.productName,
      qty: unitsToQuantity(item.qty),
      pricePerUnit: paisaToRupees(item.pricePerUnit),
      lineTotal: paisaToRupees(item.lineTotal),
    })),
    status: (sale.voidInfo.voidedAt ? "VOIDED" : "ACTIVE") as VoidStatusLabel,
    voidedAt: sale.voidInfo.voidedAt,
    voidReason: sale.voidInfo.reason,
  };
}