import { prisma } from "../../lib/prisma";
import { paisaToRupees } from "../../lib/money";
import { attachVoidStatus } from "../voids/void.repository";

import { toPurchase } from "./purchase.mapper";
import type {
  Purchase,
  PurchaseRepository,
  CreatePurchaseRepositoryInput,
  ListPurchasesInput,
} from "./purchase.types";

type Db = {
  purchase: typeof prisma.purchase;
  voidRecord: typeof prisma.voidRecord;
};

export class PrismaPurchaseRepository implements PurchaseRepository {
  constructor(private readonly db: Db = prisma) {}

  async create(input: CreatePurchaseRepositoryInput): Promise<Purchase> {
    const raw = await this.db.purchase.create({
      data: {
        supplierId: input.supplierId,
        paymentType: input.paymentType,
        total: paisaToRupees(input.total),
        items: {
          create: input.items.map((item) => ({
            productId: item.productId,
            qty: item.qty,
            costPerUnit: paisaToRupees(item.costPerUnit),
          })),
        },
      },
      include: { items: true },
    });

    return toPurchase(raw);
  }

  async findById(id: string): Promise<Purchase | null> {
    const raw = await this.db.purchase.findUnique({
      where: { id },
      include: { items: true },
    });

    if (!raw) return null;

    const [purchase] = await attachVoidStatus(this.db, "PURCHASE", [
      toPurchase(raw),
    ]);

    return purchase;
  }

  async list(): Promise<Purchase[]> {
    const raw = await this.db.purchase.findMany({
      include: { items: true },
      orderBy: { date: "desc" },
    });

    return attachVoidStatus(this.db, "PURCHASE", raw.map(toPurchase));
  }

  async listPaginated(input: ListPurchasesInput): Promise<Purchase[]> {
    const { paymentType, supplierId, cursor, limit } = input;

    const where: Record<string, unknown> = {};

    if (paymentType) {
      where.paymentType = paymentType;
    }

    if (supplierId) {
      where.supplierId = supplierId;
    }

    const raw = await this.db.purchase.findMany({
      where,
      include: { items: true },
      orderBy: [{ date: "desc" }, { id: "desc" }],
      ...(cursor
        ? {
            cursor: { id: cursor.id },
            skip: 1,
          }
        : {}),
      take: limit + 1,
    });

    return attachVoidStatus(this.db, "PURCHASE", raw.map(toPurchase));
  }
}