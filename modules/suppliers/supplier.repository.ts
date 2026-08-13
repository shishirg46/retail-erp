import { prisma } from "../../lib/prisma";

import type { Supplier, SupplierRepository, CreateSupplierInput } from "./supplier.types";

type Db = {
  supplier: typeof prisma.supplier;
};

function toSupplier(raw: {
  id: string;
  name: string;
  contact: string | null;
  balanceOwed: unknown;
  createdAt: Date;
}): Supplier {
  return {
    id: raw.id,
    name: raw.name,
    contact: raw.contact,
    balanceOwed: (raw.balanceOwed as { toNumber: () => number }).toNumber(),
    createdAt: raw.createdAt,
  };
}

export class PrismaSupplierRepository implements SupplierRepository {
  constructor(private readonly db: Db = prisma) {}

  async create(input: CreateSupplierInput): Promise<Supplier> {
    const raw = await this.db.supplier.create({
      data: {
        name: input.name,
        contact: input.contact,
      },
    });

    return toSupplier(raw);
  }

  async findById(id: string): Promise<Supplier | null> {
    const raw = await this.db.supplier.findUnique({ where: { id } });

    return raw ? toSupplier(raw) : null;
  }

  async list(): Promise<Supplier[]> {
    const raw = await this.db.supplier.findMany({ orderBy: { createdAt: "desc" } });

    return raw.map(toSupplier);
  }

  async updateBalance(id: string, amountChange: number): Promise<Supplier> {
    const raw = await this.db.supplier.update({
      where: { id },
      data: { balanceOwed: { increment: amountChange } },
    });

    return toSupplier(raw);
  }
}