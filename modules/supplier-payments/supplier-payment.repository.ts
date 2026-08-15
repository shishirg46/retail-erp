import { prisma } from "../../lib/prisma";
import { paisaFromDecimal, paisaToRupees } from "../../lib/money";

import type {
  SupplierPayment,
  SupplierPaymentRepository,
  CreateSupplierPaymentInput,
  ListSupplierPaymentsInput,
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
    amount: paisaFromDecimal(raw.amount),
    date: raw.date,
  };
}

// API output view: whole-paisa domain -> rupee wire representation (D11).
export function toSupplierPaymentApi(payment: SupplierPayment): SupplierPayment {
  return {
    ...payment,
    amount: paisaToRupees(payment.amount),
  };
}

export class PrismaSupplierPaymentRepository implements SupplierPaymentRepository {
  constructor(private readonly db: Db = prisma) {}

  async create(input: CreateSupplierPaymentInput): Promise<SupplierPayment> {
    const raw = await this.db.supplierPayment.create({
      data: {
        supplierId: input.supplierId,
        amount: paisaToRupees(input.amount),
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

  async listPaginated(input: ListSupplierPaymentsInput): Promise<SupplierPayment[]> {
    const { supplierId, cursor, limit } = input;

    const where: Record<string, unknown> = {};

    if (supplierId) {
      where.supplierId = supplierId;
    }

    const raw = await this.db.supplierPayment.findMany({
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

    return raw.map(toSupplierPayment);
  }
}