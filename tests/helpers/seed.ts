// Deterministic seed helpers for integration suites.
//
// Everything is created through the real repositories/services (the same code
// paths production uses), so seeded fixtures start from the same facts the app
// depends on: products at stockQty 0, opening stock entered via a CORRECTION
// movement (D6), and balances moved only by the ledger services.

import type { PrismaClient } from "../../generated/prisma/client";
import { PrismaProductRepository } from "../../modules/products/product.repository";
import { PrismaCustomerRepository } from "../../modules/customers/customer.repository";
import { PrismaSupplierRepository } from "../../modules/suppliers/supplier.repository";
import { StockService } from "../../modules/stock/stock.service";

import type { CreateProductInput } from "../../modules/products/product.types";

export async function createProduct(
  prisma: PrismaClient,
  input: CreateProductInput
): Promise<{ id: string; name: string }> {
  const product = await new PrismaProductRepository(prisma).create(input);
  return { id: product.id, name: product.name };
}

export async function createCustomer(
  prisma: PrismaClient,
  name: string
): Promise<string> {
  const customer = await new PrismaCustomerRepository(prisma).create({ name });
  return customer.id;
}

export async function createSupplier(
  prisma: PrismaClient,
  name: string
): Promise<string> {
  const supplier = await new PrismaSupplierRepository(prisma).create({ name });
  return supplier.id;
}

// Opening stock via CORRECTION (D6): the movement trail stays consistent so
// the stockQty == Σ movements identity can be asserted against the fixture.
export async function seedStock(
  prisma: PrismaClient,
  productId: string,
  target: number
): Promise<void> {
  await new StockService(prisma).adjustStock({
    productId,
    reason: "CORRECTION",
    quantity: target,
    note: "test seed",
  });
}