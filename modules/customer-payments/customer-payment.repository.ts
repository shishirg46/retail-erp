import { prisma } from "../../lib/prisma";
import { paisaFromDecimal, paisaToRupees } from "../../lib/money";
import { attachVoidStatus } from "../voids/void.repository";
import type {
  VoidStatusLabel,
  VoidStatusOutput,
} from "../voids/void.types";

import type {
  CreditPayment,
  CreditPaymentRepository,
  CreateCreditPaymentRepositoryInput,
  ListCreditPaymentsInput,
} from "./customer-payment.types";

type Db = {
  creditPayment: typeof prisma.creditPayment;
  voidRecord: typeof prisma.voidRecord;
};

function toCreditPayment(raw: {
  id: string;
  customerId: string;
  saleId: string | null;
  amount: unknown;
  date: Date;
}): CreditPayment {
  return {
    id: raw.id,
    customerId: raw.customerId,
    saleId: raw.saleId,
    amount: paisaFromDecimal(raw.amount),
    date: raw.date,
    voidInfo: { voidedAt: null, reason: null },
  };
}

// API output view: whole-paisa domain -> rupee wire representation (D11),
// plus the computed void status (D18.9).
export type CreditPaymentApi = CreditPayment & VoidStatusOutput;

export function toCreditPaymentApi(payment: CreditPayment): CreditPaymentApi {
  return {
    ...payment,
    amount: paisaToRupees(payment.amount),
    status: (payment.voidInfo.voidedAt ? "VOIDED" : "ACTIVE") as VoidStatusLabel,
    voidedAt: payment.voidInfo.voidedAt,
    voidReason: payment.voidInfo.reason,
  };
}

export class PrismaCreditPaymentRepository implements CreditPaymentRepository {
  constructor(private readonly db: Db = prisma) {}

  async create(input: CreateCreditPaymentRepositoryInput): Promise<CreditPayment> {
    const raw = await this.db.creditPayment.create({
      data: {
        customerId: input.customerId,
        saleId: input.saleId,
        amount: paisaToRupees(input.amount),
      },
    });

    return toCreditPayment(raw);
  }

  async findById(id: string): Promise<CreditPayment | null> {
    const raw = await this.db.creditPayment.findUnique({ where: { id } });

    if (!raw) return null;

    const [payment] = await attachVoidStatus(this.db, "CREDIT_PAYMENT", [
      toCreditPayment(raw),
    ]);

    return payment;
  }

  async list(): Promise<CreditPayment[]> {
    const raw = await this.db.creditPayment.findMany({
      orderBy: { date: "desc" },
    });

    return attachVoidStatus(
      this.db,
      "CREDIT_PAYMENT",
      raw.map(toCreditPayment)
    );
  }

  async listPaginated(input: ListCreditPaymentsInput): Promise<CreditPayment[]> {
    const { customerId, cursor, limit } = input;

    const where: Record<string, unknown> = {};

    if (customerId) {
      where.customerId = customerId;
    }

    const raw = await this.db.creditPayment.findMany({
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
      "CREDIT_PAYMENT",
      raw.map(toCreditPayment)
    );
  }
}