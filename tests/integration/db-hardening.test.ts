// DB hardening suite (F-05 / ERP-006).
//
// Proves the defense-in-depth layer added directly to Postgres:
//   * the 17 CHECK constraints and 9 report indexes from the F-05 migration
//     actually exist in the catalog (not just in the migration file)
//   * invalid rows are rejected at the DB layer even when raw SQL bypasses the
//     services — no application bug can silently write bad data anymore
//   * legitimate signed values keep working: prepaid customers (D4), overpaid
//     suppliers (D3), a no-op CORRECTION (qty_change 0), and valid
//     PURCHASE-in / SALE-out signs
//   * the D3/D4/D6 + wallet reconciliation invariants still hold end-to-end

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { paisaFromDecimal } from "../../lib/money";
import { CustomerPaymentService } from "../../modules/customer-payments/customer-payment.service";
import { SupplierPaymentService } from "../../modules/supplier-payments/supplier-payment.service";
import { PurchaseService } from "../../modules/purchases/purchase.service";
import { SaleService } from "../../modules/sales/sale.service";
import { createTestPrisma, reconcile, truncateAll } from "../helpers/db";
import { createCustomer, createProduct, createSupplier, units } from "../helpers/seed";

const prisma = createTestPrisma();
const uuid = (): string => randomUUID();

const F05_CHECK_CONSTRAINTS = [
  "products_stock_qty_nonnegative",
  "products_stock_qty_pcs_integer",
  "products_unit_supported",
  "products_cost_price_nonnegative",
  "products_current_price_positive",
  "price_tiers_min_qty_positive",
  "price_tiers_price_positive",
  "sale_items_qty_positive",
  "sale_items_price_per_unit_nonnegative",
  "purchase_items_qty_positive",
  "purchase_items_cost_per_unit_nonnegative",
  "sales_total_positive",
  "purchases_total_nonnegative",
  "credit_payments_amount_positive",
  "supplier_payments_amount_positive",
  "wallet_transactions_amount_nonnegative",
  "stock_movements_purchase_qty_positive",
  "stock_movements_sale_qty_negative",
  "stock_movements_damage_qty_negative",
] as const;

const F05_INDEXES = [
  "credit_payments_customer_id_date_idx",
  "purchase_items_purchase_id_idx",
  "purchases_date_idx",
  "sale_items_sale_id_idx",
  "sales_date_idx",
  "stock_movements_product_id_date_idx",
  "stock_movements_date_idx",
  "supplier_payments_supplier_id_date_idx",
  "wallet_transactions_date_idx",
] as const;

async function checkConstraintNames(): Promise<string[]> {
  const rows = await prisma.$queryRawUnsafe<{ conname: string }[]>(`
    SELECT c.conname::text AS conname
    FROM pg_constraint c
    JOIN pg_class t ON t.oid = c.conrelid
    JOIN pg_namespace n ON n.oid = t.relnamespace
    WHERE c.contype = 'c' AND n.nspname = 'public'
  `);
  return rows.map((r) => r.conname);
}

async function indexNames(): Promise<string[]> {
  const rows = await prisma.$queryRawUnsafe<{ indexname: string }[]>(`
    SELECT i.indexname::text AS indexname
    FROM pg_indexes i
    WHERE i.schemaname = 'public'
  `);
  return rows.map((r) => r.indexname);
}

const PRODUCT_SQL = (id: string): string => `
  INSERT INTO "products" ("id", "name", "unit", "cost_price", "current_price", "updated_at")
  VALUES ('${id}', 'Raw', 'pcs', 10, 20, now())
`;

describe("F-05 migration objects", () => {
  beforeEach(async () => {
    await truncateAll(prisma);
  });

  afterEach(async () => {
    const violations = await reconcile(prisma);
    expect(violations.join("; ") || "ok").toBe("ok");
  });

  it("all 19 CHECK constraints exist in pg_constraint", async () => {
    const names = await checkConstraintNames();
    expect([...names].sort()).toEqual([...F05_CHECK_CONSTRAINTS].sort());
  });

  it("all 9 report indexes exist in pg_indexes", async () => {
    const names = await indexNames();
    for (const index of F05_INDEXES) {
      expect(names).toContain(index);
    }
  });
});

describe("CHECK constraints reject invalid rows (raw SQL)", () => {
  beforeEach(async () => {
    await truncateAll(prisma);
  });

  afterEach(async () => {
    const violations = await reconcile(prisma);
    expect(violations.join("; ") || "ok").toBe("ok");
  });

  it("products.stock_qty < 0", async () => {
    await expect(
      prisma.$transaction(async (tx) => {
        await tx.$executeRawUnsafe(`
          INSERT INTO "products" ("id", "name", "unit", "cost_price", "current_price", "stock_qty", "updated_at")
          VALUES ('${uuid()}', 'Raw', 'pcs', 10, 20, -1, now())
        `);
      })
    ).rejects.toThrow(/products_stock_qty_nonnegative/);
  });

  it("products.cost_price < 0", async () => {
    await expect(
      prisma.$transaction(async (tx) => {
        await tx.$executeRawUnsafe(`
          INSERT INTO "products" ("id", "name", "unit", "cost_price", "current_price", "updated_at")
          VALUES ('${uuid()}', 'Raw', 'pcs', -1, 20, now())
        `);
      })
    ).rejects.toThrow(/products_cost_price_nonnegative/);
  });

  it("products.current_price = 0", async () => {
    await expect(
      prisma.$transaction(async (tx) => {
        await tx.$executeRawUnsafe(`
          INSERT INTO "products" ("id", "name", "unit", "cost_price", "current_price", "updated_at")
          VALUES ('${uuid()}', 'Raw', 'pcs', 10, 0, now())
        `);
      })
    ).rejects.toThrow(/products_current_price_positive/);
  });

  it("price_tiers.min_qty = 0", async () => {
    const productId = uuid();
    await expect(
      prisma.$transaction(async (tx) => {
        await tx.$executeRawUnsafe(PRODUCT_SQL(productId));
        await tx.$executeRawUnsafe(`
          INSERT INTO "price_tiers" ("id", "product_id", "min_qty", "price")
          VALUES ('${uuid()}', '${productId}', 0, 5)
        `);
      })
    ).rejects.toThrow(/price_tiers_min_qty_positive/);
  });

  it("price_tiers.price = 0", async () => {
    const productId = uuid();
    await expect(
      prisma.$transaction(async (tx) => {
        await tx.$executeRawUnsafe(PRODUCT_SQL(productId));
        await tx.$executeRawUnsafe(`
          INSERT INTO "price_tiers" ("id", "product_id", "min_qty", "price")
          VALUES ('${uuid()}', '${productId}', 1, 0)
        `);
      })
    ).rejects.toThrow(/price_tiers_price_positive/);
  });

  it("sales.total = 0", async () => {
    await expect(
      prisma.$transaction(async (tx) => {
        await tx.$executeRawUnsafe(`
          INSERT INTO "sales" ("id", "payment_type", "total")
          VALUES ('${uuid()}', 'CASH', 0)
        `);
      })
    ).rejects.toThrow(/sales_total_positive/);
  });

  it("sale_items.qty = 0", async () => {
    const productId = uuid();
    const saleId = uuid();
    await expect(
      prisma.$transaction(async (tx) => {
        await tx.$executeRawUnsafe(PRODUCT_SQL(productId));
        await tx.$executeRawUnsafe(`
          INSERT INTO "sales" ("id", "payment_type", "total")
          VALUES ('${saleId}', 'CASH', 100)
        `);
        await tx.$executeRawUnsafe(`
          INSERT INTO "sale_items" ("id", "sale_id", "product_id", "qty", "price_per_unit")
          VALUES ('${uuid()}', '${saleId}', '${productId}', 0, 10)
        `);
      })
    ).rejects.toThrow(/sale_items_qty_positive/);
  });

  it("sale_items.price_per_unit < 0", async () => {
    const productId = uuid();
    const saleId = uuid();
    await expect(
      prisma.$transaction(async (tx) => {
        await tx.$executeRawUnsafe(PRODUCT_SQL(productId));
        await tx.$executeRawUnsafe(`
          INSERT INTO "sales" ("id", "payment_type", "total")
          VALUES ('${saleId}', 'CASH', 100)
        `);
        await tx.$executeRawUnsafe(`
          INSERT INTO "sale_items" ("id", "sale_id", "product_id", "qty", "price_per_unit")
          VALUES ('${uuid()}', '${saleId}', '${productId}', 1, -10)
        `);
      })
    ).rejects.toThrow(/sale_items_price_per_unit_nonnegative/);
  });

  it("purchases.total < 0", async () => {
    const supplierId = uuid();
    await expect(
      prisma.$transaction(async (tx) => {
        await tx.$executeRawUnsafe(`
          INSERT INTO "suppliers" ("id", "name")
          VALUES ('${supplierId}', 'Raw')
        `);
        await tx.$executeRawUnsafe(`
          INSERT INTO "purchases" ("id", "supplier_id", "payment_type", "total")
          VALUES ('${uuid()}', '${supplierId}', 'CASH', -1)
        `);
      })
    ).rejects.toThrow(/purchases_total_nonnegative/);
  });

  it("purchase_items.qty = 0", async () => {
    const productId = uuid();
    const supplierId = uuid();
    const purchaseId = uuid();
    await expect(
      prisma.$transaction(async (tx) => {
        await tx.$executeRawUnsafe(PRODUCT_SQL(productId));
        await tx.$executeRawUnsafe(`
          INSERT INTO "suppliers" ("id", "name")
          VALUES ('${supplierId}', 'Raw')
        `);
        await tx.$executeRawUnsafe(`
          INSERT INTO "purchases" ("id", "supplier_id", "payment_type", "total")
          VALUES ('${purchaseId}', '${supplierId}', 'CASH', 100)
        `);
        await tx.$executeRawUnsafe(`
          INSERT INTO "purchase_items" ("id", "purchase_id", "product_id", "qty", "cost_per_unit")
          VALUES ('${uuid()}', '${purchaseId}', '${productId}', 0, 10)
        `);
      })
    ).rejects.toThrow(/purchase_items_qty_positive/);
  });

  it("purchase_items.cost_per_unit < 0", async () => {
    const productId = uuid();
    const supplierId = uuid();
    const purchaseId = uuid();
    await expect(
      prisma.$transaction(async (tx) => {
        await tx.$executeRawUnsafe(PRODUCT_SQL(productId));
        await tx.$executeRawUnsafe(`
          INSERT INTO "suppliers" ("id", "name")
          VALUES ('${supplierId}', 'Raw')
        `);
        await tx.$executeRawUnsafe(`
          INSERT INTO "purchases" ("id", "supplier_id", "payment_type", "total")
          VALUES ('${purchaseId}', '${supplierId}', 'CASH', 100)
        `);
        await tx.$executeRawUnsafe(`
          INSERT INTO "purchase_items" ("id", "purchase_id", "product_id", "qty", "cost_per_unit")
          VALUES ('${uuid()}', '${purchaseId}', '${productId}', 1, -10)
        `);
      })
    ).rejects.toThrow(/purchase_items_cost_per_unit_nonnegative/);
  });

  it("credit_payments.amount = 0", async () => {
    const customerId = uuid();
    await expect(
      prisma.$transaction(async (tx) => {
        await tx.$executeRawUnsafe(`
          INSERT INTO "customers" ("id", "name")
          VALUES ('${customerId}', 'Raw')
        `);
        await tx.$executeRawUnsafe(`
          INSERT INTO "credit_payments" ("id", "customer_id", "amount")
          VALUES ('${uuid()}', '${customerId}', 0)
        `);
      })
    ).rejects.toThrow(/credit_payments_amount_positive/);
  });

  it("supplier_payments.amount = 0", async () => {
    const supplierId = uuid();
    await expect(
      prisma.$transaction(async (tx) => {
        await tx.$executeRawUnsafe(`
          INSERT INTO "suppliers" ("id", "name")
          VALUES ('${supplierId}', 'Raw')
        `);
        await tx.$executeRawUnsafe(`
          INSERT INTO "supplier_payments" ("id", "supplier_id", "amount")
          VALUES ('${uuid()}', '${supplierId}', 0)
        `);
      })
    ).rejects.toThrow(/supplier_payments_amount_positive/);
  });

  it("wallet_transactions.amount < 0", async () => {
    await expect(
      prisma.$transaction(async (tx) => {
        await tx.$executeRawUnsafe(`
          INSERT INTO "wallet_transactions" ("id", "type", "source", "amount")
          VALUES ('${uuid()}', 'DEPOSIT', 'OTHER', -1)
        `);
      })
    ).rejects.toThrow(/wallet_transactions_amount_nonnegative/);
  });

  it("PURCHASE movement with qty_change 0", async () => {
    const productId = uuid();
    await expect(
      prisma.$transaction(async (tx) => {
        await tx.$executeRawUnsafe(PRODUCT_SQL(productId));
        await tx.$executeRawUnsafe(`
          INSERT INTO "stock_movements" ("id", "product_id", "qty_change", "reason")
          VALUES ('${uuid()}', '${productId}', 0, 'PURCHASE')
        `);
      })
    ).rejects.toThrow(/stock_movements_purchase_qty_positive/);
  });

  it("SALE movement with qty_change 1 (should be negative)", async () => {
    const productId = uuid();
    await expect(
      prisma.$transaction(async (tx) => {
        await tx.$executeRawUnsafe(PRODUCT_SQL(productId));
        await tx.$executeRawUnsafe(`
          INSERT INTO "stock_movements" ("id", "product_id", "qty_change", "reason")
          VALUES ('${uuid()}', '${productId}', 1, 'SALE')
        `);
      })
    ).rejects.toThrow(/stock_movements_sale_qty_negative/);
  });

  it("DAMAGE movement with qty_change 1 (should be negative)", async () => {
    const productId = uuid();
    await expect(
      prisma.$transaction(async (tx) => {
        await tx.$executeRawUnsafe(PRODUCT_SQL(productId));
        await tx.$executeRawUnsafe(`
          INSERT INTO "stock_movements" ("id", "product_id", "qty_change", "reason")
          VALUES ('${uuid()}', '${productId}', 1, 'DAMAGE')
        `);
      })
    ).rejects.toThrow(/stock_movements_damage_qty_negative/);
  });
});

describe("legitimate signed and special values stay valid", () => {
  beforeEach(async () => {
    await truncateAll(prisma);
  });

  afterEach(async () => {
    const violations = await reconcile(prisma);
    expect(violations.join("; ") || "ok").toBe("ok");
  });

  it("prepaid customer balance stays negative (D4)", async () => {
    const customerId = await createCustomer(prisma, "F05 Advance Buyer");
    const service = new CustomerPaymentService(prisma);

    await service.createCustomerPayment({ customerId, amount: 1000 });
    await service.createCustomerPayment({ customerId, amount: 500 });

    const customer = await prisma.customer.findUnique({ where: { id: customerId } });
    expect(paisaFromDecimal(customer!.balanceOwed)).toBe(-1500);
  });

  it("overpaid supplier balance stays negative (D3)", async () => {
    const supplierId = await createSupplier(prisma, "F05 Overpaid");
    const service = new SupplierPaymentService(prisma);

    await service.createSupplierPayment({ supplierId, amount: 200 });

    const supplier = await prisma.supplier.findUnique({ where: { id: supplierId } });
    expect(paisaFromDecimal(supplier!.balanceOwed)).toBe(-200);
  });

  it("CORRECTION qty_change 0 is a valid no-op", async () => {
    const product = await createProduct(prisma, {
      name: "F05 No-op",
      unit: "pcs",
      costPrice: 5,
      currentPrice: 10,
    });

    await prisma.$executeRawUnsafe(`
      INSERT INTO "stock_movements" ("id", "product_id", "qty_change", "reason")
      VALUES ('${uuid()}', '${product.id}', 0, 'CORRECTION')
    `);

    const fresh = await prisma.product.findUnique({ where: { id: product.id } });
    expect(Number(fresh!.stockQty)).toBe(0);
  });

  it("valid PURCHASE (+) and SALE (-) movement signs work end-to-end", async () => {
    const product = await createProduct(prisma, {
      name: "F05 Signs",
      unit: "pcs",
      costPrice: 10,
      currentPrice: 15,
    });
    const supplierId = await createSupplier(prisma, "F05 Stock");
    const purchaseService = new PurchaseService(prisma);
    const saleService = new SaleService(prisma);

    await purchaseService.createPurchase({
      supplierId,
      paymentType: "CASH",
      items: [{ productId: product.id, quantity: units(10), costPerUnit: 10 }],
    });
    await saleService.createSale({
      paymentType: "CASH",
      items: [{ productId: product.id, quantity: units(4) }],
    });

    const fresh = await prisma.product.findUnique({ where: { id: product.id } });
    expect(Number(fresh!.stockQty)).toBe(6);
  });

  it("signed ledgers keep D3/D4/D6 + wallet reconcilable", async () => {
    const product = await createProduct(prisma, {
      name: "F05 Reconcile",
      unit: "kg",
      costPrice: 20,
      currentPrice: 25,
    });
    const supplierId = await createSupplier(prisma, "F05 Source");
    const customerId = await createCustomer(prisma, "F05 Buyer");
    const purchaseService = new PurchaseService(prisma);
    const saleService = new SaleService(prisma);
    const customerPaymentService = new CustomerPaymentService(prisma);
    const supplierPaymentService = new SupplierPaymentService(prisma);

    await supplierPaymentService.createSupplierPayment({ supplierId, amount: 100 });
    await purchaseService.createPurchase({
      supplierId,
      paymentType: "CREDIT",
      items: [{ productId: product.id, quantity: units(10), costPerUnit: 20 }],
    });
    await saleService.createSale({
      paymentType: "CREDIT",
      customerId,
      items: [{ productId: product.id, quantity: units(4) }],
    });
    await customerPaymentService.createCustomerPayment({ customerId, amount: 150 });
    await saleService.createSale({
      paymentType: "CASH",
      items: [{ productId: product.id, quantity: units(2) }],
    });

    const violations = await reconcile(prisma);
    expect(violations).toEqual([]);
  });
});
