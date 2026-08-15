import { prisma } from "../../lib/prisma";
import { paisaFromDecimal, paisaToRupees } from "../../lib/money";
import { attachVoidStatus } from "../voids/void.repository";
import type {
  VoidStatusLabel,
  VoidStatusOutput,
} from "../voids/void.types";

import type {
  SupplierPayment,
  SupplierPaymentRepository,
  CreateSupplierPaymentInput,
  ListSupplierPaymentsInput,
} from "./supplier-payment.types";

type Db = {
  supplierPayment: typeof prisma.supplierPayment;
  voidRecord: typeof prisma.voidRecord;
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
    voidInfo: { voidedAt: null, reason: null },
  };
}

// API output view: whole-paisa domain -> rupee wire representation (D11),
// plus the computed void status (D18.9).
export type SupplierPaymentApi = SupplierPayment & VoidStatusOutput;

export function toSupplierPaymentApi(
  payment: SupplierPayment
): SupplierPaymentApi {
  return {
    ...payment,
    amount: paisaToRupees(payment.amount),
    status: (payment.voidInfo.voidedAt ? "VOIDED" : "ACTIVE") as VoidStatusLabel,
    voidedAt: payment.voidInfo.voidedAt,
    voidReason: payment.voidInfo.reason,
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

  async findById(id: string): Promise<SupplierPayment | null> {
    const raw = await this.db.supplierPayment.findUnique({ where: { id } });

    if (!raw) return null;

    const [payment] = await attachVoidStatus(this.db, "SUPPLIER_PAYMENT", [
      toSupplierPayment(raw),
    ]);

    return payment;
  }

  async list(): Promise<SupplierPayment[]> {
    const raw = await this.db.supplierPayment.findMany({
      orderBy: { date: "desc" },
    });

    return attachVoidStatus(
      this.db,
      "SUPPLIER_PAYMENT",
      raw.map(toSupplierPayment)
    );
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

    return attachVoidStatus(
      this.db,
      "SUPPLIER_PAYMENT",
      raw.map(toSupplierPayment)
    );
  }
}