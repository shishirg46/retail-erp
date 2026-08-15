import { prisma } from "../../lib/prisma";

import type {
  StockMovement,
  StockRepository,
  CreateStockMovementInput,
  ListStockMovementsInput,
} from "./stock.types";

type Db = {
  stockMovement: typeof prisma.stockMovement;
};

function toStockMovement(
  raw: { id: string; productId: string; qtyChange: number; reason: string; date: Date; note: string | null }
): StockMovement {
  return {
    id: raw.id,
    productId: raw.productId,
    qtyChange: raw.qtyChange,
    reason: raw.reason as StockMovement["reason"],
    date: raw.date,
    note: raw.note,
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
      },
    });

    return toStockMovement(raw);
  }

  async listByProduct(productId: string): Promise<StockMovement[]> {
    const raw = await this.db.stockMovement.findMany({
      where: { productId },
      orderBy: { date: "desc" },
    });

    return raw.map(toStockMovement);
  }

  async list(): Promise<StockMovement[]> {
    const raw = await this.db.stockMovement.findMany({
      orderBy: { date: "desc" },
    });

    return raw.map(toStockMovement);
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

    return raw.map(toStockMovement);
  }
}