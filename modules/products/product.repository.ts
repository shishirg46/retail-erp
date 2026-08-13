import { prisma } from "../../lib/prisma";
import { Prisma } from "../../generated/prisma/client";
import { ValidationError } from "../../lib/errors";

import type {
  Product,
  ProductRepository,
  CreateProductInput,
} from "./product.types";

type Db = {
  product: typeof prisma.product;
};

type ProductWithTiers = Prisma.ProductGetPayload<{
  include: { priceTiers: true };
}>;

function toProduct(raw: ProductWithTiers): Product {
  return {
    ...raw,
    costPrice: raw.costPrice.toNumber(),
    currentPrice: raw.currentPrice.toNumber(),
    priceTiers: raw.priceTiers.map((tier) => ({
      ...tier,
      price: tier.price.toNumber(),
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
        costPrice: input.costPrice,
        currentPrice: input.currentPrice,
        priceTiers: input.priceTiers?.length
          ? {
              create: input.priceTiers.map((tier) => ({
                minQty: tier.minQty,
                price: tier.price,
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

  async updateStock(id: string, qtyChange: number): Promise<Product> {
    const raw = await this.db.product.update({
      where: { id },
      data: {
        stockQty: {
          increment: qtyChange,
        },
      },
      ...withPriceTiers,
    });

    return toProduct(raw);
  }

  async reserveStock(id: string, qty: number): Promise<Product | null> {
    if (!Number.isInteger(qty) || qty <= 0) {
      throw new ValidationError("quantity must be a positive integer");
    }

    // Atomic conditional decrement: the row is only updated when at least
    // `qty` remains. Under Postgres READ COMMITTED the UPDATE re-evaluates
    // the WHERE clause against the latest committed row version, so two
    // racing transactions cannot both succeed on the last unit.
    const result = await this.db.product.updateMany({
      where: { id, stockQty: { gte: qty } },
      data: { stockQty: { decrement: qty } },
    });

    if (result.count === 0) {
      return null;
    }

    return this.findById(id);
  }

  async updateCostPrice(id: string, costPrice: number): Promise<Product> {
    const raw = await this.db.product.update({
      where: { id },
      data: { costPrice },
      ...withPriceTiers,
    });

    return toProduct(raw);
  }
}