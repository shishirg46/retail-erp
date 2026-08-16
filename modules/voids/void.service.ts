import {
  BusinessRuleError,
  ConflictError,
  InsufficientStockError,
  NotFoundError,
} from "../../lib/errors";
import { lockSaleRow } from "../../lib/locks";
import { prisma } from "../../lib/prisma";
import { paisaFromDecimal } from "../../lib/money";
import { unitsToQuantity } from "../../lib/quantity";
import { PrismaCustomerRepository } from "../customers/customer.repository";
import { PrismaCreditPaymentRepository } from "../customer-payments/customer-payment.repository";
import { PrismaProductRepository } from "../products/product.repository";
import { PrismaPurchaseRepository } from "../purchases/purchase.repository";
import { PrismaSaleRepository } from "../sales/sale.repository";
import { PrismaStockRepository } from "../stock/stock.repository";
import { PrismaSupplierPaymentRepository } from "../supplier-payments/supplier-payment.repository";
import { PrismaSupplierRepository } from "../suppliers/supplier.repository";
import { PrismaWalletRepository } from "../wallet/wallet.repository";
import { PrismaVoidRecordRepository } from "./void.repository";

import type { VoidInput, VoidResult, VoidTargetType } from "./void.types";

// M18 void operations (D18). Every void is atomic (D18.11): the VoidRecord is
// written together with the reversal of the transaction's financial and stock
// side effects. The original transactional rows are never deleted. Offsetting
// ledger records (wallet transactions, stock movements with reason VOID) carry
// the voided origin's FK so reports and reconciliation can exclude them
// deterministically (D18.8).

type VoidedIds = Record<VoidTargetType, string[]>;

export class VoidService {
  constructor(private readonly db: typeof prisma) {}

  private async voidedIdsFor(targetType: VoidTargetType): Promise<string[]> {
    return new PrismaVoidRecordRepository(this.db).listVoidedTargetIds(targetType);
  }

  private async assertNotVoided(
    tx: { voidRecord: typeof prisma.voidRecord },
    targetType: VoidTargetType,
    targetId: string,
    label: string
  ): Promise<void> {
    const existing = await new PrismaVoidRecordRepository(tx).findByTarget(
      targetType,
      targetId
    );

    if (existing) {
      throw new ConflictError(`${label} '${targetId}' is already voided`);
    }
  }

  // The latest non-voided purchase cost for a product (D18.5 Option A). Only
  // purchase history that has not itself been voided participates; if nothing
  // remains the cost is 0.
  private async latestNonVoidedCost(
    tx: { purchaseItem: typeof prisma.purchaseItem },
    productId: string,
    voidedIds: VoidedIds
  ): Promise<number> {
    const excluded = new Set([...voidedIds.PURCHASE]);

    const latest = await tx.purchaseItem.findFirst({
      where: {
        productId,
        purchaseId: { notIn: [...excluded] },
      },
      orderBy: [{ purchase: { date: "desc" } }, { purchase: { id: "desc" } }],
      select: { costPerUnit: true },
    });

    return latest ? paisaFromDecimal(latest.costPerUnit) : 0;
  }

  async voidSale(id: string, input: VoidInput): Promise<VoidResult> {
    return this.db.$transaction(async (tx) => {
      const saleRepository = new PrismaSaleRepository(tx);
      const voidRepository = new PrismaVoidRecordRepository(tx);
      const productRepository = new PrismaProductRepository(tx);
      const stockRepository = new PrismaStockRepository(tx);
      const walletRepository = new PrismaWalletRepository(tx);
      const customerRepository = new PrismaCustomerRepository(tx);

      const sale = await saleRepository.findById(id);

      if (!sale) {
        throw new NotFoundError(`Sale '${id}' not found`);
      }

      // D18.11 — serialize with concurrent payment creation on this sale. The
      // exclusive lock on the sales row guarantees that the voided/blocking
      // state read below sees whatever the other operation committed.
      await lockSaleRow(tx, sale.id);

      await this.assertNotVoided(tx, "SALE", sale.id, "Sale");

      // D18.4 — a Sale with active linked credit payments cannot be voided
      // until those payments are voided first.
      const linked = await tx.creditPayment.findMany({
        where: { saleId: sale.id },
        select: { id: true },
      });

      if (linked.length > 0) {
        const voidedPayments = await tx.voidRecord.findMany({
          where: {
            targetType: "CREDIT_PAYMENT",
            targetId: { in: linked.map((payment) => payment.id) },
          },
          select: { targetId: true },
        });
        const voided = new Set(voidedPayments.map((record) => record.targetId));
        const blocking = linked.filter((payment) => !voided.has(payment.id));

        if (blocking.length > 0) {
          throw new BusinessRuleError(
            `Sale has active linked credit payments that must be voided first: ${blocking
              .map((payment) => payment.id)
              .join(", ")}`
          );
        }
      }

      // Stock: restore the sold quantity, reversing the SALE movements.
      for (const item of sale.items) {
        await productRepository.updateStock(item.productId, item.qty);
        await stockRepository.createMovement({
          productId: item.productId,
          qtyChange: item.qty,
          reason: "VOID",
          note: `Void of sale ${sale.id}`,
          saleId: sale.id,
        });
      }

      // Wallet: reverse the DEPOSIT created by CASH/ECASH sales.
      if (sale.paymentType !== "CREDIT") {
        await walletRepository.create({
          type: "WITHDRAWAL",
          source: "VOID",
          amount: sale.total,
          note: `Void of sale ${sale.id}`,
          saleId: sale.id,
        });
      }

      // Customer balance: reverse the CREDIT increase (D4).
      if (sale.paymentType === "CREDIT" && sale.customerId) {
        await customerRepository.updateBalance(sale.customerId, -sale.total);
      }

      const record = await voidRepository.create({
        targetType: "SALE",
        targetId: sale.id,
        reason: input.reason,
        note: input.note,
        voidedBy: input.voidedBy,
      });

      return {
        voidId: record.id,
        targetType: "SALE",
        targetId: sale.id,
        reason: record.reason,
        note: record.note,
        voidedAt: record.voidedAt,
      };
    });
  }

  async voidPurchase(id: string, input: VoidInput): Promise<VoidResult> {
    return this.db.$transaction(async (tx) => {
      const purchaseRepository = new PrismaPurchaseRepository(tx);
      const voidRepository = new PrismaVoidRecordRepository(tx);
      const productRepository = new PrismaProductRepository(tx);
      const stockRepository = new PrismaStockRepository(tx);
      const walletRepository = new PrismaWalletRepository(tx);
      const supplierRepository = new PrismaSupplierRepository(tx);

      const purchase = await purchaseRepository.findById(id);

      if (!purchase) {
        throw new NotFoundError(`Purchase '${id}' not found`);
      }

      await this.assertNotVoided(tx, "PURCHASE", purchase.id, "Purchase");

      // D18.6 — reversing the purchase removes stock; never below zero.
      for (const item of purchase.items) {
        const reserved = await productRepository.reserveStock(
          item.productId,
          item.qty
        );

        if (!reserved) {
          throw new InsufficientStockError(
            `Product no longer has ${unitsToQuantity(item.qty)} units to reverse — purchase void would make stock negative`
          );
        }

        await stockRepository.createMovement({
          productId: item.productId,
          qtyChange: -item.qty,
          reason: "VOID",
          note: `Void of purchase ${purchase.id}`,
          purchaseId: purchase.id,
        });
      }

      // D18.5 Option A — re-derive costPrice from the remaining non-voided
      // purchase history.
      const voidedIds: VoidedIds = {
        SALE: [],
        PURCHASE: await voidRepository.listVoidedTargetIds("PURCHASE"),
        CREDIT_PAYMENT: [],
        SUPPLIER_PAYMENT: [],
        STOCK_MOVEMENT: [],
      };
      voidedIds.PURCHASE.push(purchase.id);

      for (const item of purchase.items) {
        const costPrice = await this.latestNonVoidedCost(
          tx as unknown as { purchaseItem: typeof prisma.purchaseItem },
          item.productId,
          voidedIds
        );
        await productRepository.updateCostPrice(item.productId, costPrice);
      }

      // Wallet: reverse the WITHDRAWAL created by CASH purchases.
      if (purchase.paymentType === "CASH") {
        await walletRepository.create({
          type: "DEPOSIT",
          source: "VOID",
          amount: purchase.total,
          note: `Void of purchase ${purchase.id}`,
          purchaseId: purchase.id,
        });
      }

      // Supplier balance: reverse the CREDIT increase (D3).
      if (purchase.paymentType === "CREDIT") {
        await supplierRepository.updateBalance(purchase.supplierId, -purchase.total);
      }

      const record = await voidRepository.create({
        targetType: "PURCHASE",
        targetId: purchase.id,
        reason: input.reason,
        note: input.note,
        voidedBy: input.voidedBy,
      });

      return {
        voidId: record.id,
        targetType: "PURCHASE",
        targetId: purchase.id,
        reason: record.reason,
        note: record.note,
        voidedAt: record.voidedAt,
      };
    });
  }

  async voidCreditPayment(id: string, input: VoidInput): Promise<VoidResult> {
    return this.db.$transaction(async (tx) => {
      const paymentRepository = new PrismaCreditPaymentRepository(tx);
      const voidRepository = new PrismaVoidRecordRepository(tx);
      const walletRepository = new PrismaWalletRepository(tx);
      const customerRepository = new PrismaCustomerRepository(tx);

      const payment = await paymentRepository.findById(id);

      if (!payment) {
        throw new NotFoundError(`CreditPayment '${id}' not found`);
      }

      await this.assertNotVoided(tx, "CREDIT_PAYMENT", payment.id, "CreditPayment");

      // Customer balance: reverse the payment — the customer owes it again (D4).
      await customerRepository.updateBalance(payment.customerId, payment.amount);

      // Wallet: reverse the DEPOSIT created by the payment.
      await walletRepository.create({
        type: "WITHDRAWAL",
        source: "VOID",
        amount: payment.amount,
        note: `Void of credit payment ${payment.id}`,
        creditPaymentId: payment.id,
      });

      const record = await voidRepository.create({
        targetType: "CREDIT_PAYMENT",
        targetId: payment.id,
        reason: input.reason,
        note: input.note,
        voidedBy: input.voidedBy,
      });

      return {
        voidId: record.id,
        targetType: "CREDIT_PAYMENT",
        targetId: payment.id,
        reason: record.reason,
        note: record.note,
        voidedAt: record.voidedAt,
      };
    });
  }

  async voidSupplierPayment(id: string, input: VoidInput): Promise<VoidResult> {
    return this.db.$transaction(async (tx) => {
      const paymentRepository = new PrismaSupplierPaymentRepository(tx);
      const voidRepository = new PrismaVoidRecordRepository(tx);
      const walletRepository = new PrismaWalletRepository(tx);
      const supplierRepository = new PrismaSupplierRepository(tx);

      const payment = await paymentRepository.findById(id);

      if (!payment) {
        throw new NotFoundError(`SupplierPayment '${id}' not found`);
      }

      await this.assertNotVoided(tx, "SUPPLIER_PAYMENT", payment.id, "SupplierPayment");

      // Supplier balance: reverse the payment — the shop owes it again (D3).
      await supplierRepository.updateBalance(payment.supplierId, payment.amount);

      // Wallet: reverse the WITHDRAWAL created by the payment (FK-linked).
      await walletRepository.create({
        type: "DEPOSIT",
        source: "VOID",
        amount: payment.amount,
        note: `Void of supplier payment ${payment.id}`,
        supplierPaymentId: payment.id,
      });

      const record = await voidRepository.create({
        targetType: "SUPPLIER_PAYMENT",
        targetId: payment.id,
        reason: input.reason,
        note: input.note,
        voidedBy: input.voidedBy,
      });

      return {
        voidId: record.id,
        targetType: "SUPPLIER_PAYMENT",
        targetId: payment.id,
        reason: record.reason,
        note: record.note,
        voidedAt: record.voidedAt,
      };
    });
  }

  async voidStockMovement(id: string, input: VoidInput): Promise<VoidResult> {
    return this.db.$transaction(async (tx) => {
      const movementRepository = new PrismaStockRepository(tx);
      const voidRepository = new PrismaVoidRecordRepository(tx);
      const productRepository = new PrismaProductRepository(tx);
      const stockRepository = new PrismaStockRepository(tx);

      const movement = await movementRepository.findById(id);

      if (!movement) {
        throw new NotFoundError(`StockMovement '${id}' not found`);
      }

      // Only manual adjustments (DAMAGE / CORRECTION) can be voided directly.
      // Sale/purchase movements are reversed by voiding the origin transaction.
      if (movement.reason === "PURCHASE" || movement.reason === "SALE") {
        throw new BusinessRuleError(
          `Stock movement '${id}' belongs to a ${movement.reason.toLowerCase()} — void the originating ${movement.reason.toLowerCase()} instead`
        );
      }

      if (movement.reason === "VOID") {
        throw new BusinessRuleError(
          `Stock movement '${id}' is a void reversal and cannot be voided`
        );
      }

      await this.assertNotVoided(
        tx,
        "STOCK_MOVEMENT",
        movement.id,
        "StockMovement"
      );

      // Reverse the movement. A reversal that removes stock must never drive
      // it below zero (D18.6) — use the atomic conditional decrement.
      const reversal = -movement.qtyChange;

      if (reversal < 0) {
        const reserved = await productRepository.reserveStock(
          movement.productId,
          -reversal
        );

        if (!reserved) {
          throw new InsufficientStockError(
            `Product no longer has ${unitsToQuantity(-reversal)} units to reverse — stock cannot go negative`
          );
        }
      } else if (reversal > 0) {
        await productRepository.updateStock(movement.productId, reversal);
      }

      await stockRepository.createMovement({
        productId: movement.productId,
        qtyChange: reversal,
        reason: "VOID",
        note: `Void of stock movement ${movement.id}`,
      });

      const record = await voidRepository.create({
        targetType: "STOCK_MOVEMENT",
        targetId: movement.id,
        reason: input.reason,
        note: input.note,
        voidedBy: input.voidedBy,
      });

      return {
        voidId: record.id,
        targetType: "STOCK_MOVEMENT",
        targetId: movement.id,
        reason: record.reason,
        note: record.note,
        voidedAt: record.voidedAt,
      };
    });
  }
}
