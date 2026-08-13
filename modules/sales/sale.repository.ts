import { prisma } from "../../lib/prisma";

import { toSale } from "./sale.mapper";
import type {
  Sale,
  SaleRepository,
  CreateSaleRepositoryInput,
} from "./sale.types";

type Db = {
  sale: typeof prisma.sale;
};

export class PrismaSaleRepository implements SaleRepository {
  constructor(private readonly db: Db = prisma) {}

  async create(input: CreateSaleRepositoryInput): Promise<Sale> {
    const raw = await this.db.sale.create({
      data: {
        paymentType: input.paymentType,
        customerId: input.customerId,
        total: input.total,
        items: {
          create: input.items.map((item) => ({
            productId: item.productId,
            qty: item.qty,
            pricePerUnit: item.pricePerUnit,
          })),
        },
      },
      include: { items: true },
    });

    return toSale(raw);
  }

  async findById(id: string): Promise<Sale | null> {
    const raw = await this.db.sale.findUnique({
      where: { id },
      include: { items: true },
    });

    return raw ? toSale(raw) : null;
  }

  async list(): Promise<Sale[]> {
    const raw = await this.db.sale.findMany({
      include: { items: true },
      orderBy: { date: "desc" },
    });

    return raw.map(toSale);
  }
}