import { BusinessRuleError, NotFoundError } from "../../lib/errors";
import { prisma } from "../../lib/prisma";
import { PrismaCustomerRepository } from "../customers/customer.repository";
import { PrismaSaleRepository } from "../sales/sale.repository";
import { PrismaWalletRepository } from "../wallet/wallet.repository";
import { PrismaCreditPaymentRepository } from "./customer-payment.repository";

import type {
  CreateCustomerPaymentInput,
  CreditPayment,
} from "./customer-payment.types";

export class CustomerPaymentService {
  constructor(private readonly db: typeof prisma) {}

  async createCustomerPayment(
    input: CreateCustomerPaymentInput
  ): Promise<CreditPayment> {
    return this.db.$transaction(async (tx) => {
      const customerRepository = new PrismaCustomerRepository(tx);
      const paymentRepository = new PrismaCreditPaymentRepository(tx);
      const walletRepository = new PrismaWalletRepository(tx);

      // 1. Customer must exist.
      const customer = await customerRepository.findById(input.customerId);

      if (!customer) {
        throw new NotFoundError(`Customer '${input.customerId}' not found`);
      }

      // 2. Optional sale link: sale must exist, belong to this customer,
      //    and be a CREDIT sale (D5 + non-credit-sale rule).
      const saleId: string | null = input.saleId ?? null;

      if (input.saleId) {
        const sale = await new PrismaSaleRepository(tx).findById(input.saleId);

        if (!sale) {
          throw new NotFoundError(`Sale '${input.saleId}' not found`);
        }

        if (sale.customerId !== input.customerId) {
          throw new BusinessRuleError(
            "saleId does not belong to this customer"
          );
        }

        if (sale.paymentType !== "CREDIT") {
          throw new BusinessRuleError(
            "payments can only be linked to CREDIT sales"
          );
        }
      }

      // 3. Record the payment, reduce what the customer owes — may go
      //    negative into prepaid credit (D4) — and deposit the money.
      const payment = await paymentRepository.create({
        customerId: input.customerId,
        amount: input.amount,
        saleId,
      });

      await customerRepository.updateBalance(input.customerId, -input.amount);

      await walletRepository.create({
        type: "DEPOSIT",
        source: "CREDIT_PAYMENT",
        amount: input.amount,
        note: `CreditPayment ${payment.id}`,
        creditPaymentId: payment.id,
      });

      return payment;
    });
  }

  async listCustomerPayments(): Promise<CreditPayment[]> {
    const repository = new PrismaCreditPaymentRepository(this.db);
    return repository.list();
  }

  async listCustomerPaymentsPaginated(
    input: import("./customer-payment.types").ListCreditPaymentsInput
  ): Promise<CreditPayment[]> {
    const repository = new PrismaCreditPaymentRepository(this.db);
    return repository.listPaginated(input);
  }
}