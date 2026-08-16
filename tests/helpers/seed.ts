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
import { quantityToUnits } from "../../lib/quantity";

import type { CreateProductInput } from "../../modules/products/product.types";

// Human units -> scaled units (the quantity analogue of rupees -> paisa,
// D25.6). Domain-facing inputs/assertions in the suites go through this so a
// test that "sells 2 kg" passes quantity units(2) === 200.
export const units = (n: number): number => quantityToUnits(n);

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
// `target` is a human-unit final level; it is converted to scaled units here.
export async function seedStock(
  prisma: PrismaClient,
  productId: string,
  target: number
): Promise<void> {
  await new StockService(prisma).adjustStock({
    productId,
    reason: "CORRECTION",
    quantity: quantityToUnits(target),
    note: "test seed",
  });
}