import { prisma } from "../../lib/prisma";

import type {
  WalletTransaction,
  WalletRepository,
  CreateWalletTransactionInput,
} from "./wallet.types";

type Db = {
  walletTransaction: typeof prisma.walletTransaction;
};

function toWalletTransaction(
  raw: {
    id: string;
    type: string;
    source: string;
    amount: unknown;
    date: Date;
    note: string | null;
    saleId: string | null;
    creditPaymentId: string | null;
  }
): WalletTransaction {
  return {
    id: raw.id,
    type: raw.type as WalletTransaction["type"],
    source: raw.source as WalletTransaction["source"],
    amount: (raw.amount as { toNumber: () => number }).toNumber(),
    date: raw.date,
    note: raw.note,
    saleId: raw.saleId,
    creditPaymentId: raw.creditPaymentId,
  };
}

export class PrismaWalletRepository implements WalletRepository {
  constructor(private readonly db: Db = prisma) {}

  async create(input: CreateWalletTransactionInput): Promise<WalletTransaction> {
    const raw = await this.db.walletTransaction.create({
      data: {
        type: input.type,
        source: input.source,
        amount: input.amount,
        note: input.note,
        saleId: input.saleId,
        creditPaymentId: input.creditPaymentId,
      },
    });

    return toWalletTransaction(raw);
  }
}