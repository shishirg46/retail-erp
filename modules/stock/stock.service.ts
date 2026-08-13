import { InsufficientStockError, NotFoundError } from "../../lib/errors";
import { prisma } from "../../lib/prisma";
import { PrismaProductRepository } from "../products/product.repository";
import { PrismaStockRepository } from "./stock.repository";

import type {
  AdjustStockInput,
  AdjustStockResult,
  StockMovement,
} from "./stock.types";

export class StockService {
  constructor(private readonly db: typeof prisma) {}

  async adjustStock(input: AdjustStockInput): Promise<AdjustStockResult> {
    return this.db.$transaction(async (tx) => {
      const productRepository = new PrismaProductRepository(tx);
      const stockRepository = new PrismaStockRepository(tx);

      // 1. Product must exist.
      const product = await productRepository.findById(input.productId);

      if (!product) {
        throw new NotFoundError(`Product '${input.productId}' not found`);
      }

      // 2. Signed change per D6:
      //    DAMAGE -> -quantity (amount ruined)
      //    CORRECTION -> target - current (desired final level)
      const qtyChange =
        input.reason === "DAMAGE"
          ? -input.quantity
          : input.quantity - product.stockQty;

      // 3. Never allow stock to go below zero — reject before any write.
      if (product.stockQty + qtyChange < 0) {
        throw new InsufficientStockError(
          `adjustment would leave ${product.name} at ${product.stockQty + qtyChange} units — stock cannot go negative`
        );
      }

      // 4. Apply + audit, atomically. No wallet/customer/supplier side-effects.
      const updated = await productRepository.updateStock(
        input.productId,
        qtyChange
      );

      const movement = await stockRepository.createMovement({
        productId: input.productId,
        qtyChange,
        reason: input.reason,
        note: input.note,
      });

      return {
        product: { id: updated.id, stockQty: updated.stockQty },
        movement,
      };
    });
  }

  async listMovements(productId?: string): Promise<StockMovement[]> {
    const repository = new PrismaStockRepository(this.db);

    if (productId) {
      return repository.listByProduct(productId);
    }

    return repository.list();
  }
}