import { prisma } from "../../lib/prisma";
import { paisaToRupees } from "../../lib/money";

import { toPurchase } from "./purchase.mapper";
import type {
  Purchase,
  PurchaseRepository,
  CreatePurchaseRepositoryInput,
} from "./purchase.types";

type Db = {
  purchase: typeof prisma.purchase;
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

    return raw ? toPurchase(raw) : null;
  }

  async list(): Promise<Purchase[]> {
    const raw = await this.db.purchase.findMany({
      include: { items: true },
      orderBy: { date: "desc" },
    });

    return raw.map(toPurchase);
  }
}