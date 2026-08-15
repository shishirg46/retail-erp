import { NotFoundError } from "../../lib/errors";
import { prisma } from "../../lib/prisma";
import { PrismaProductRepository } from "../products/product.repository";
import { PrismaStockRepository } from "../stock/stock.repository";
import { PrismaSupplierRepository } from "../suppliers/supplier.repository";
import { PrismaWalletRepository } from "../wallet/wallet.repository";
import { PrismaPurchaseRepository } from "./purchase.repository";

import type { CreatePurchaseInput, Purchase } from "./purchase.types";

export class PurchaseService {
  constructor(private readonly db: typeof prisma) {}

  async createPurchase(input: CreatePurchaseInput): Promise<Purchase> {
    return this.db.$transaction(async (tx) => {
      const supplierRepository = new PrismaSupplierRepository(tx);
      const productRepository = new PrismaProductRepository(tx);
      const purchaseRepository = new PrismaPurchaseRepository(tx);
      const stockRepository = new PrismaStockRepository(tx);
      const walletRepository = new PrismaWalletRepository(tx);

      // 1. Supplier must exist.
      const supplier = await supplierRepository.findById(input.supplierId);

      if (!supplier) {
        throw new NotFoundError(`Supplier '${input.supplierId}' not found`);
      }

      // 2. Every purchased product must exist; accumulate the total.
      const items: { productId: string; qty: number; costPerUnit: number }[] = [];
      let grandTotal = 0;

      for (const item of input.items) {
        const product = await productRepository.findById(item.productId);

        if (!product) {
          throw new NotFoundError(`Product '${item.productId}' not found`);
        }

        grandTotal += item.quantity * item.costPerUnit;

        items.push({
          productId: product.id,
          qty: item.quantity,
          costPerUnit: item.costPerUnit,
        });
      }

      // 3. Create the purchase with its items (historical cost frozen here).
      const purchase = await purchaseRepository.create({
        supplierId: input.supplierId,
        paymentType: input.paymentType,
        total: grandTotal,
        items,
      });

      // 4. Move stock in, reprice to the latest cost, audit each movement.
      for (const item of items) {
        await productRepository.updateStock(item.productId, item.qty);
        await productRepository.updateCostPrice(item.productId, item.costPerUnit);
        await stockRepository.createMovement({
          productId: item.productId,
          qtyChange: item.qty,
          reason: "PURCHASE",
          note: `Purchase ${purchase.id}`,
          purchaseId: purchase.id,
        });
      }

      // 5. Financial side of the purchase (D3):
      //    CASH -> the cash box is debited immediately.
      //    CREDIT -> the shop owes the supplier; no wallet entry yet.
      if (input.paymentType === "CREDIT") {
        await supplierRepository.updateBalance(input.supplierId, grandTotal);
      } else {
        await walletRepository.create({
          type: "WITHDRAWAL",
          source: "SUPPLIER_PAYMENT",
          amount: grandTotal,
          note: `Purchase ${purchase.id}`,
          purchaseId: purchase.id,
        });
      }

      return purchase;
    });
  }

  async findPurchaseById(id: string): Promise<Purchase | null> {
    const repository = new PrismaPurchaseRepository(this.db);
    return repository.findById(id);
  }

  async listPurchases(): Promise<Purchase[]> {
    const repository = new PrismaPurchaseRepository(this.db);
    return repository.list();
  }

  async listPurchasesPaginated(input: import("./purchase.types").ListPurchasesInput): Promise<Purchase[]> {
    const repository = new PrismaPurchaseRepository(this.db);
    return repository.listPaginated(input);
  }
}