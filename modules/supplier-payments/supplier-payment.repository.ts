import { prisma } from "../../lib/prisma";

import type {
  SupplierPayment,
  SupplierPaymentRepository,
  CreateSupplierPaymentInput,
} from "./supplier-payment.types";

type Db = {
  supplierPayment: typeof prisma.supplierPayment;
};

function toSupplierPayment(raw: {
  id: string;
  supplierId: string;
  amount: unknown;
  date: Date;
}): SupplierPayment {
  return {
    id: raw.id,
    supplierId: raw.supplierId,
    amount: (raw.amount as { toNumber: () => number }).toNumber(),
    date: raw.date,
  };
}

export class PrismaSupplierPaymentRepository implements SupplierPaymentRepository {
  constructor(private readonly db: Db = prisma) {}

  async create(input: CreateSupplierPaymentInput): Promise<SupplierPayment> {
    const raw = await this.db.supplierPayment.create({
      data: {
        supplierId: input.supplierId,
        amount: input.amount,
      },
    });

    return toSupplierPayment(raw);
  }

  async list(): Promise<SupplierPayment[]> {
    const raw = await this.db.supplierPayment.findMany({
      orderBy: { date: "desc" },
    });

    return raw.map(toSupplierPayment);
  }
}