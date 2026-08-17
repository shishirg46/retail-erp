import { prisma } from "../../lib/prisma";
import { quantityFromDecimal, unitsToQuantity } from "../../lib/quantity";
import { attachVoidStatus } from "../voids/void.repository";

import type {
  StockMovement,
  StockRepository,
  CreateStockMovementInput,
  ListStockMovementsInput,
} from "./stock.types";

type Db = {
  stockMovement: typeof prisma.stockMovement;
  voidRecord: typeof prisma.voidRecord;
};

type NestedRecord = Record<string, unknown>;
function nestedName(obj: unknown, ...keys: string[]): string | null {
  let cur: unknown = obj;
  for (const k of keys) {
    if (cur === null || cur === undefined || typeof cur !== "object") return null;
    cur = (cur as NestedRecord)[k];
  }
  return typeof cur === "string" ? cur : null;
}

function toStockMovement(
  raw: {
    id: string;
    productId: string;
    productName: string;
    qtyChange: unknown;
    reason: string;
    date: Date;
    note: string | null;
    saleId: string | null;
    purchaseId: string | null;
    saleCustomerName?: string | null;
    purchaseSupplierName?: string | null;
  }
): StockMovement {
  return {
    id: raw.id,
    productId: raw.productId,
    productName: raw.productName,
    qtyChange: quantityFromDecimal(raw.qtyChange),
    reason: raw.reason as StockMovement["reason"],
    date: raw.date,
    note: raw.note,
    saleId: raw.saleId,
    purchaseId: raw.purchaseId,
    saleCustomerName: raw.saleCustomerName ?? null,
    purchaseSupplierName: raw.purchaseSupplierName ?? null,
    voidInfo: { voidedAt: null, reason: null },
  };
}

// API output view for stock movements (D25.6: scaled units -> human units),
// plus the computed void status (D18.9).
export type StockMovementApi = StockMovement & {
  status: "ACTIVE" | "VOIDED";
  voidedAt: Date | null;
  voidReason: string | null;
  saleCustomerName: string | null;
  purchaseSupplierName: string | null;
};

export function toStockMovementApi(movement: StockMovement): StockMovementApi {
  return {
    ...movement,
    qtyChange: unitsToQuantity(movement.qtyChange),
    status: movement.voidInfo.voidedAt ? "VOIDED" : "ACTIVE",
    voidedAt: movement.voidInfo.voidedAt,
    voidReason: movement.voidInfo.reason,
  };
}

// API output view for a stock adjustment result: domain (scaled units) ->
// wire (human quantities, D25.6).
export function toAdjustStockResultApi(result: {
  product: { id: string; stockQty: number };
  movement: StockMovement;
}) {
  return {
    product: {
      id: result.product.id,
      stockQty: unitsToQuantity(result.product.stockQty),
    },
    movement: toStockMovementApi(result.movement),
  };
}

export class PrismaStockRepository implements StockRepository {
  constructor(private readonly db: Db = prisma) {}

  async createMovement(input: CreateStockMovementInput): Promise<StockMovement> {
    const raw = await this.db.stockMovement.create({
      data: {
        productId: input.productId,
        qtyChange: unitsToQuantity(input.qtyChange),
        reason: input.reason,
        note: input.note,
        saleId: input.saleId,
        purchaseId: input.purchaseId,
      },
      include: {
        product: { select: { name: true } },
        sale: input.saleId ? { select: { customer: { select: { name: true } } } } : false,
        purchase: input.purchaseId ? { select: { supplier: { select: { name: true } } } } : false,
      },
    });

    return toStockMovement({
      ...raw,
      productName: raw.product.name,
      saleCustomerName: nestedName(raw, "sale", "customer", "name"),
      purchaseSupplierName: nestedName(raw, "purchase", "supplier", "name"),
    });
  }

  async findById(id: string): Promise<StockMovement | null> {
    const raw = await this.db.stockMovement.findUnique({
      where: { id },
      include: {
        product: { select: { name: true } },
        sale: { select: { customer: { select: { name: true } } } },
        purchase: { select: { supplier: { select: { name: true } } } },
      },
    });

    if (!raw) return null;

    const [movement] = await attachVoidStatus(this.db, "STOCK_MOVEMENT", [
      toStockMovement({
        ...raw,
        productName: raw.product.name,
        saleCustomerName: raw.sale?.customer?.name ?? null,
        purchaseSupplierName: raw.purchase?.supplier?.name ?? null,
      }),
    ]);

    return movement;
  }

  async listByProduct(productId: string): Promise<StockMovement[]> {
    const raw = await this.db.stockMovement.findMany({
      where: { productId },
      orderBy: { date: "desc" },
      include: {
        product: { select: { name: true } },
        sale: { select: { customer: { select: { name: true } } } },
        purchase: { select: { supplier: { select: { name: true } } } },
      },
    });

    return attachVoidStatus(
      this.db,
      "STOCK_MOVEMENT",
      raw.map((r) => toStockMovement({
        ...r,
        productName: r.product.name,
        saleCustomerName: r.sale?.customer?.name ?? null,
        purchaseSupplierName: r.purchase?.supplier?.name ?? null,
      }))
    );
  }

  async list(): Promise<StockMovement[]> {
    const raw = await this.db.stockMovement.findMany({
      orderBy: { date: "desc" },
      include: {
        product: { select: { name: true } },
        sale: { select: { customer: { select: { name: true } } } },
        purchase: { select: { supplier: { select: { name: true } } } },
      },
    });

    return attachVoidStatus(
      this.db,
      "STOCK_MOVEMENT",
      raw.map((r) => toStockMovement({
        ...r,
        productName: r.product.name,
        saleCustomerName: r.sale?.customer?.name ?? null,
        purchaseSupplierName: r.purchase?.supplier?.name ?? null,
      }))
    );
  }

  async listPaginated(input: ListStockMovementsInput): Promise<StockMovement[]> {
    const { productId, reason, cursor, limit } = input;

    const where: Record<string, unknown> = {};

    if (productId) {
      where.productId = productId;
    }

    if (reason) {
      where.reason = reason;
    }

    const raw = await this.db.stockMovement.findMany({
      where,
      orderBy: [{ date: "desc" }, { id: "desc" }],
      include: {
        product: { select: { name: true } },
        sale: { select: { customer: { select: { name: true } } } },
        purchase: { select: { supplier: { select: { name: true } } } },
      },
      ...(cursor
        ? {
            cursor: { id: cursor.id },
            skip: 1,
          }
        : {}),
      take: limit + 1,
    });

    return attachVoidStatus(
      this.db,
      "STOCK_MOVEMENT",
      raw.map((r) => toStockMovement({
        ...r,
        productName: r.product.name,
        saleCustomerName: r.sale?.customer?.name ?? null,
        purchaseSupplierName: r.purchase?.supplier?.name ?? null,
      }))
    );
  }
}