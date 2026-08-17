import { prisma } from "../../lib/prisma";
import { Prisma } from "../../generated/prisma/client";
import { ValidationError } from "../../lib/errors";
import { paisaFromDecimal, paisaToRupees } from "../../lib/money";
import {
  quantityFromDecimal,
  unitsToQuantity,
} from "../../lib/quantity";

import type {
  Product,
  ProductRepository,
  CreateProductInput,
  ListProductsInput,
} from "./product.types";

type Db = {
  product: typeof prisma.product;
};

type ProductWithTiers = Prisma.ProductGetPayload<{
  include: { priceTiers: true };
}>;

// DB (DECIMAL human units) -> domain (whole paisa + scaled units, D11/D25.6).
function toProduct(raw: ProductWithTiers): Product {
  return {
    ...raw,
    costPrice: paisaFromDecimal(raw.costPrice),
    currentPrice: paisaFromDecimal(raw.currentPrice),
    stockQty: quantityFromDecimal(raw.stockQty),
    priceTiers: raw.priceTiers.map((tier) => ({
      ...tier,
      minQty: quantityFromDecimal(tier.minQty),
      price: paisaFromDecimal(tier.price),
    })),
  };
}

// API output view: whole-paisa domain -> rupee wire representation (D11), and
// scaled units -> human quantities (D25.6).
export function toProductApi(product: Product): Product {
  return {
    ...product,
    costPrice: paisaToRupees(product.costPrice),
    currentPrice: paisaToRupees(product.currentPrice),
    stockQty: unitsToQuantity(product.stockQty),
    priceTiers: product.priceTiers.map((tier) => ({
      ...tier,
      minQty: unitsToQuantity(tier.minQty),
      price: paisaToRupees(tier.price),
    })),
  };
}

const withPriceTiers = {
  include: {
    priceTiers: true,
  },
};

export class PrismaProductRepository implements ProductRepository {
  constructor(private readonly db: Db = prisma) {}

  async create(input: CreateProductInput): Promise<Product> {
    const raw = await this.db.product.create({
      data: {
        name: input.name,
        category: input.category,
        unit: input.unit,
        costPrice: paisaToRupees(input.costPrice),
        currentPrice: paisaToRupees(input.currentPrice),
        ...(input.unitsPerPack !== undefined
          ? { unitsPerPack: input.unitsPerPack }
          : {}),
        priceTiers: input.priceTiers?.length
          ? {
              create: input.priceTiers.map((tier) => ({
                minQty: unitsToQuantity(tier.minQty),
                price: paisaToRupees(tier.price),
              })),
            }
          : undefined,
      },
      ...withPriceTiers,
    });

    return toProduct(raw);
  }

  async findById(id: string): Promise<Product | null> {
    const raw = await this.db.product.findUnique({
      where: { id },
      ...withPriceTiers,
    });

    return raw ? toProduct(raw) : null;
  }

  async list(): Promise<Product[]> {
    const raw = await this.db.product.findMany(withPriceTiers);

    return raw.map(toProduct);
  }

  async listPaginated(input: ListProductsInput): Promise<Product[]> {
    const { search, category, cursor, limit } = input;

    const where: Record<string, unknown> = {};

    if (search) {
      where.name = { contains: search, mode: "insensitive" };
    }

    if (category) {
      where.category = category;
    }

    // Fetch limit + 1 to detect whether there is a next page.
    const raw = await this.db.product.findMany({
      where,
      include: { priceTiers: true },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      ...(cursor
        ? {
            cursor: { id: cursor.id },
            skip: 1, // skip the cursor row itself
          }
        : {}),
      take: limit + 1,
    });

    return raw.map(toProduct);
  }

  async updateStock(id: string, qtyChange: number): Promise<Product> {
    const raw = await this.db.product.update({
      where: { id },
      data: {
        stockQty: {
          increment: unitsToQuantity(qtyChange),
        },
      },
      ...withPriceTiers,
    });

    return toProduct(raw);
  }

  async reserveStock(id: string, qty: number): Promise<Product | null> {
    // `qty` is scaled units (D25.6) — always an integer hundredth count.
    if (!Number.isInteger(qty) || qty <= 0) {
      throw new ValidationError("quantity must be a positive integer");
    }

    // Atomic conditional decrement: the row is only updated when at least
    // `qty` (in DECIMAL human units) remains. Under Postgres READ COMMITTED
    // the UPDATE re-evaluates the WHERE clause against the latest committed
    // row version, so two racing transactions cannot both succeed on the last
    // unit.
    const result = await this.db.product.updateMany({
      where: { id, stockQty: { gte: unitsToQuantity(qty) } },
      data: { stockQty: { decrement: unitsToQuantity(qty) } },
    });

    if (result.count === 0) {
      return null;
    }

    return this.findById(id);
  }

  async updateCostPrice(id: string, costPrice: number): Promise<Product> {
    const raw = await this.db.product.update({
      where: { id },
      data: { costPrice: paisaToRupees(costPrice) },
      ...withPriceTiers,
    });

    return toProduct(raw);
  }
}