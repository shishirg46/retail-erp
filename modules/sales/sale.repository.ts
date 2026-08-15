import { prisma } from "../../lib/prisma";
import { paisaToRupees } from "../../lib/money";
import { attachVoidStatus } from "../voids/void.repository";

import { toSale } from "./sale.mapper";
import type {
  Sale,
  SaleRepository,
  CreateSaleRepositoryInput,
  ListSalesInput,
} from "./sale.types";

type Db = {
  sale: typeof prisma.sale;
  voidRecord: typeof prisma.voidRecord;
};

export class PrismaSaleRepository implements SaleRepository {
  constructor(private readonly db: Db = prisma) {}

  async create(input: CreateSaleRepositoryInput): Promise<Sale> {
    const raw = await this.db.sale.create({
      data: {
        paymentType: input.paymentType,
        customerId: input.customerId,
        total: paisaToRupees(input.total),
        items: {
          create: input.items.map((item) => ({
            productId: item.productId,
            qty: item.qty,
            pricePerUnit: paisaToRupees(item.pricePerUnit),
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

    if (!raw) return null;

    const [sale] = await attachVoidStatus(this.db, "SALE", [toSale(raw)]);

    return sale;
  }

  async list(): Promise<Sale[]> {
    const raw = await this.db.sale.findMany({
      include: { items: true },
      orderBy: { date: "desc" },
    });

    return attachVoidStatus(this.db, "SALE", raw.map(toSale));
  }

  async listPaginated(input: ListSalesInput): Promise<Sale[]> {
    const { paymentType, cursor, limit } = input;

    const where: Record<string, unknown> = {};

    if (paymentType) {
      where.paymentType = paymentType;
    }

    const raw = await this.db.sale.findMany({
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

    return attachVoidStatus(this.db, "SALE", raw.map(toSale));
  }
}