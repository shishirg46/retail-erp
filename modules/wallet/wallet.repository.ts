import { prisma } from "../../lib/prisma";
import { paisaFromDecimal, paisaToRupees } from "../../lib/money";

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
    purchaseId: string | null;
    creditPaymentId: string | null;
    supplierPaymentId: string | null;
  }
): WalletTransaction {
  return {
    id: raw.id,
    type: raw.type as WalletTransaction["type"],
    source: raw.source as WalletTransaction["source"],
    amount: paisaFromDecimal(raw.amount),
    date: raw.date,
    note: raw.note,
    saleId: raw.saleId,
    purchaseId: raw.purchaseId,
    creditPaymentId: raw.creditPaymentId,
    supplierPaymentId: raw.supplierPaymentId,
  };
}

export class PrismaWalletRepository implements WalletRepository {
  constructor(private readonly db: Db = prisma) {}

  async create(input: CreateWalletTransactionInput): Promise<WalletTransaction> {
    const raw = await this.db.walletTransaction.create({
      data: {
        type: input.type,
        source: input.source,
        amount: paisaToRupees(input.amount),
        note: input.note,
        saleId: input.saleId,
        purchaseId: input.purchaseId,
        creditPaymentId: input.creditPaymentId,
        supplierPaymentId: input.supplierPaymentId,
      },
    });

    return toWalletTransaction(raw);
  }
}