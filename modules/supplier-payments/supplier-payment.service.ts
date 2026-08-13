import { NotFoundError } from "../../lib/errors";
import { prisma } from "../../lib/prisma";
import { PrismaSupplierRepository } from "../suppliers/supplier.repository";
import { PrismaWalletRepository } from "../wallet/wallet.repository";
import { PrismaSupplierPaymentRepository } from "./supplier-payment.repository";

import type {
  CreateSupplierPaymentInput,
  SupplierPayment,
} from "./supplier-payment.types";

export class SupplierPaymentService {
  constructor(private readonly db: typeof prisma) {}

  async createSupplierPayment(
    input: CreateSupplierPaymentInput
  ): Promise<SupplierPayment> {
    return this.db.$transaction(async (tx) => {
      const supplierRepository = new PrismaSupplierRepository(tx);
      const paymentRepository = new PrismaSupplierPaymentRepository(tx);
      const walletRepository = new PrismaWalletRepository(tx);

      // 1. Supplier must exist.
      const supplier = await supplierRepository.findById(input.supplierId);

      if (!supplier) {
        throw new NotFoundError(`Supplier '${input.supplierId}' not found`);
      }

      // 2. Record the payment.
      const payment = await paymentRepository.create({
        supplierId: input.supplierId,
        amount: input.amount,
      });

      // 3. Reduce what the shop owes, and debit the cash box — atomically.
      await supplierRepository.updateBalance(input.supplierId, -input.amount);
      await walletRepository.create({
        type: "WITHDRAWAL",
        source: "SUPPLIER_PAYMENT",
        amount: input.amount,
        note: `SupplierPayment ${payment.id}`,
      });

      return payment;
    });
  }

  async listSupplierPayments(): Promise<SupplierPayment[]> {
    const repository = new PrismaSupplierPaymentRepository(this.db);
    return repository.list();
  }
}