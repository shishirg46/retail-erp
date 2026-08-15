import { prisma } from "../../lib/prisma";
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

function toStockMovement(
  raw: {
    id: string;
    productId: string;
    qtyChange: number;
    reason: string;
    date: Date;
    note: string | null;
    saleId: string | null;
    purchaseId: string | null;
  }
): StockMovement {
  return {
    id: raw.id,
    productId: raw.productId,
    qtyChange: raw.qtyChange,
    reason: raw.reason as StockMovement["reason"],
    date: raw.date,
    note: raw.note,
    saleId: raw.saleId,
    purchaseId: raw.purchaseId,
    voidInfo: { voidedAt: null, reason: null },
  };
}

// API output view for stock movements (D11 conversions not needed here — qty
// is already an integer), plus the computed void status (D18.9).
export type StockMovementApi = StockMovement & {
  status: "ACTIVE" | "VOIDED";
  voidedAt: Date | null;
  voidReason: string | null;
};

export function toStockMovementApi(movement: StockMovement): StockMovementApi {
  return {
    ...movement,
    status: movement.voidInfo.voidedAt ? "VOIDED" : "ACTIVE",
    voidedAt: movement.voidInfo.voidedAt,
    voidReason: movement.voidInfo.reason,
  };
}

export class PrismaStockRepository implements StockRepository {
  constructor(private readonly db: Db = prisma) {}

  async createMovement(input: CreateStockMovementInput): Promise<StockMovement> {
    const raw = await this.db.stockMovement.create({
      data: {
        productId: input.productId,
        qtyChange: input.qtyChange,
        reason: input.reason,
        note: input.note,
        saleId: input.saleId,
        purchaseId: input.purchaseId,
      },
    });

    return toStockMovement(raw);
  }

  async findById(id: string): Promise<StockMovement | null> {
    const raw = await this.db.stockMovement.findUnique({ where: { id } });

    if (!raw) return null;

    const [movement] = await attachVoidStatus(this.db, "STOCK_MOVEMENT", [
      toStockMovement(raw),
    ]);

    return movement;
  }

  async listByProduct(productId: string): Promise<StockMovement[]> {
    const raw = await this.db.stockMovement.findMany({
      where: { productId },
      orderBy: { date: "desc" },
    });

    return attachVoidStatus(
      this.db,
      "STOCK_MOVEMENT",
      raw.map(toStockMovement)
    );
  }

  async list(): Promise<StockMovement[]> {
    const raw = await this.db.stockMovement.findMany({
      orderBy: { date: "desc" },
    });

    return attachVoidStatus(this.db, "STOCK_MOVEMENT", raw.map(toStockMovement));
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
      ...(cursor
        ? {
            cursor: { id: cursor.id },
            skip: 1,
          }
        : {}),
      take: limit + 1,
    });

    return attachVoidStatus(this.db, "STOCK_MOVEMENT", raw.map(toStockMovement));
  }
}