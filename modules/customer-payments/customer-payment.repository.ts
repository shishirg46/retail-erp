import { prisma } from "../../lib/prisma";

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
    amount: (raw.amount as { toNumber: () => number }).toNumber(),
    date: raw.date,
  };
}

export class PrismaCreditPaymentRepository implements CreditPaymentRepository {
  constructor(private readonly db: Db = prisma) {}

  async create(input: CreateCreditPaymentRepositoryInput): Promise<CreditPayment> {
    const raw = await this.db.creditPayment.create({
      data: {
        customerId: input.customerId,
        saleId: input.saleId,
        amount: input.amount,
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