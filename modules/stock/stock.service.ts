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

      // DAMAGE: atomic conditional decrement (F-02). The successful atomic
      // update is the authority for availability — a read→check→write race
      // can no longer drive stock below zero.
      if (input.reason === "DAMAGE") {
        const reserved = await productRepository.reserveStock(
          input.productId,
          input.quantity
        );

        if (!reserved) {
          throw new InsufficientStockError(
            `${product.name} no longer has ${input.quantity} units to adjust — stock cannot go negative`
          );
        }

        const movement = await stockRepository.createMovement({
          productId: input.productId,
          qtyChange: -input.quantity,
          reason: "DAMAGE",
          note: input.note,
        });

        return {
          product: { id: reserved.id, stockQty: reserved.stockQty },
          movement,
        };
      }

      // CORRECTION: target - current (desired final level), D6. Kept as the
      // original read→check→write path — its concurrency model is
      // last-writer-wins on the target, documented out of scope for F-02.
      const qtyChange = input.quantity - product.stockQty;

      if (product.stockQty + qtyChange < 0) {
        throw new InsufficientStockError(
          `adjustment would leave ${product.name} at ${product.stockQty + qtyChange} units — stock cannot go negative`
        );
      }

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

  async listMovementsPaginated(
    input: import("./stock.types").ListStockMovementsInput
  ): Promise<StockMovement[]> {
    const repository = new PrismaStockRepository(this.db);
    return repository.listPaginated(input);
  }
}