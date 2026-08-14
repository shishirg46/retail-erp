import { prisma } from "../../lib/prisma";
import { paisaFromDecimal, paisaToRupees } from "../../lib/money";

import type {
  CreditPayment,
  CreditPaymentRepository,
  CreateCreditPaymentRepositoryInput,
} from "./customer-payment.types";

type Db = {
  creditPayment: typeof prisma.creditPayment;
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
  };
}

// API output view: whole-paisa domain -> rupee wire representation (D11).
export function toCreditPaymentApi(payment: CreditPayment): CreditPayment {
  return {
    ...payment,
    amount: paisaToRupees(payment.amount),
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

  async list(): Promise<CreditPayment[]> {
    const raw = await this.db.creditPayment.findMany({
      orderBy: { date: "desc" },
    });

    return raw.map(toCreditPayment);
  }
}