import {
  InsufficientStockError,
  NotFoundError,
  ValidationError,
} from "../../lib/errors";
import { prisma } from "../../lib/prisma";
import { PrismaProductRepository } from "../products/product.repository";
import { calculatePrice } from "../products/product.service";
import { PrismaCustomerRepository } from "../customers/customer.repository";
import { PrismaStockRepository } from "../stock/stock.repository";
import { PrismaWalletRepository } from "../wallet/wallet.repository";
import { PrismaSaleRepository } from "./sale.repository";

import type { CreateSaleInput, Sale, SaleItemDraft } from "./sale.types";

// Effective per-unit price charged at the time of sale.
// For tiered products the bundles don't map to a clean unit price, so the
// effective price is total / quantity, rounded half-up to whole paisa (D11).
// This is frozen into SaleItem.pricePerUnit for historical accuracy.
function effectiveUnitPrice(totalPaisa: number, quantity: number): number {
  return Math.round(totalPaisa / quantity);
}

export class SaleService {
  constructor(private readonly db: typeof prisma) {}

  async createSale(input: CreateSaleInput): Promise<Sale> {
    return this.db.$transaction(async (tx) => {
      const productRepository = new PrismaProductRepository(tx);
      const saleRepository = new PrismaSaleRepository(tx);
      const stockRepository = new PrismaStockRepository(tx);
      const walletRepository = new PrismaWalletRepository(tx);
      const customerRepository = new PrismaCustomerRepository(tx);

      // 1. Resolve products, check stock, price each item independently.
      const drafts: SaleItemDraft[] = [];
      const names = new Map<string, string>();
      let grandTotal = 0;

      for (const item of input.items) {
        const product = await productRepository.findById(item.productId);

        if (!product) {
          throw new NotFoundError(`Product '${item.productId}' not found`);
        }

        names.set(product.id, product.name);

        // Fast-path availability check for a helpful error message. The
        // authoritative check happens atomically in step 4 (F-02), so this
        // read→check race can no longer oversell stock.
        if (product.stockQty < item.quantity) {
          throw new InsufficientStockError(
            `${product.name} has only ${product.stockQty} in stock but ${item.quantity} requested`
          );
        }

        const total = calculatePrice(
          item.quantity,
          product.currentPrice,
          product.priceTiers
        );

        grandTotal += total;

        drafts.push({
          productId: product.id,
          quantity: item.quantity,
          unitPrice: effectiveUnitPrice(total, item.quantity),
          total,
        });
      }

      // 2. CREDIT sales always require an existing customer.
      const customerId = input.customerId;

      if (input.paymentType === "CREDIT") {
        if (!customerId) {
          throw new ValidationError("customerId is required for a CREDIT sale");
        }

        const customer = await customerRepository.findById(customerId);

        if (!customer) {
          throw new NotFoundError(`Customer '${customerId}' not found`);
        }
      }

      // 3. Create the sale with its items (pricePerUnit frozen here).
      const sale = await saleRepository.create({
        paymentType: input.paymentType,
        customerId,
        total: grandTotal,
        items: drafts.map((draft) => ({
          productId: draft.productId,
          qty: draft.quantity,
          pricePerUnit: draft.unitPrice,
        })),
      });

      // 4. Move stock down and record an auditable movement per product.
      //    The atomic conditional decrement is the authority for availability:
      //    if the row no longer has enough stock it returns null and the whole
      //    sale rolls back (F-02).
      for (const draft of drafts) {
        const reserved = await productRepository.reserveStock(
          draft.productId,
          draft.quantity
        );

        if (!reserved) {
          throw new InsufficientStockError(
            `${names.get(draft.productId)} no longer has ${draft.quantity} units in stock`
          );
        }

        await stockRepository.createMovement({
          productId: draft.productId,
          qtyChange: -draft.quantity,
          reason: "SALE",
          note: `Sale ${sale.id}`,
        });
      }

      // 5. Financial side of the sale:
      //    CASH / ECASH -> money in the wallet.
      //    CREDIT -> customer owes the shop; no wallet entry yet.
      if (input.paymentType === "CREDIT") {
        // customerId is guaranteed defined here — invalid values threw above.
        await customerRepository.updateBalance(customerId!, grandTotal);
      } else {
        await walletRepository.create({
          type: "DEPOSIT",
          source: "SALE",
          amount: grandTotal,
          note: `Sale ${sale.id}`,
          saleId: sale.id,
        });
      }

      return sale;
    });
  }

  async findSaleById(id: string): Promise<Sale | null> {
    // Read path — no transaction needed.
    const repository = new PrismaSaleRepository(this.db);
    return repository.findById(id);
  }

  async listSales(): Promise<Sale[]> {
    const repository = new PrismaSaleRepository(this.db);
    return repository.list();
  }

  async listSalesPaginated(input: import("./sale.types").ListSalesInput): Promise<Sale[]> {
    const repository = new PrismaSaleRepository(this.db);
    return repository.listPaginated(input);
  }
}