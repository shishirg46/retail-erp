// Dedicated transaction-rollback suite (Vitest).
//
// Acceptance criterion for ERP-005: "a multi-item sale with one out-of-stock
// item leaves zero partial rows across sales/sale_items/stock_movements/wallet."
// Every test captures a full table snapshot, drives an operation that
// fails inside its $transaction, then asserts the snapshot is identical —
// proving atomic all-or-nothing on the failure paths.
//
// Note on the reserve-under-race failure: the atomic reserve in
// `SaleService.createSale` step 4 can only lose deterministically when a
// concurrent writer takes the stock first. That post-creation rollback is
// exercised by the F-02 concurrency suite (S1/S3 assert the losing
// transaction rolls back) and by R0's fixture-work visible here.

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { SaleService } from "../../modules/sales/sale.service";
import { StockService } from "../../modules/stock/stock.service";
import { PurchaseService } from "../../modules/purchases/purchase.service";
import { CustomerPaymentService } from "../../modules/customer-payments/customer-payment.service";
import { SupplierPaymentService } from "../../modules/supplier-payments/supplier-payment.service";
import { createTestPrisma, truncateAll, reconcile, tableCounts } from "../helpers/db";
import { createProduct, createCustomer, createSupplier, seedStock, units } from "../helpers/seed";

const prisma = createTestPrisma();
const saleService = new SaleService(prisma);
const stockService = new StockService(prisma);
const purchaseService = new PurchaseService(prisma);
const customerPaymentService = new CustomerPaymentService(prisma);
const supplierPaymentService = new SupplierPaymentService(prisma);

describe("transaction rollback (ERP-005)", () => {
  beforeEach(async () => {
    await truncateAll(prisma);
  });

  afterEach(async () => {
    const violations = await reconcile(prisma);
    expect(violations.join("; ") || "ok").toBe("ok");
  });

  it("R0 positive control: a successful CASH sale DOES change counts", async () => {
    // Guards the harness against silently passing because the DB never truncates.
    const product = await createProduct(prisma, { name: "R0 Control", unit: "pcs", costPrice: 2, currentPrice: 5 });
    await seedStock(prisma, product.id, 5);
    const before = await tableCounts(prisma);

    await saleService.createSale({ paymentType: "CASH", items: [{ productId: product.id, quantity: units(1) }] });

    const after = await tableCounts(prisma);
    expect(after.sales).toBe(before.sales + 1);
    expect(after.sale_items).toBe(before.sale_items + 1);
    expect(after.stock_movements).toBe(before.stock_movements + 1);
    expect(after.wallet_transactions).toBe(before.wallet_transactions + 1);
  });

  it("R1 ACCEPTANCE: multi-item sale, one item out-of-stock -> zero partial rows", async () => {
    const a = await createProduct(prisma, { name: "R1 In Stock", unit: "pcs", costPrice: 2, currentPrice: 5 });
    const b = await createProduct(prisma, { name: "R1 Out Of Stock", unit: "pcs", costPrice: 2, currentPrice: 5 });
    await seedStock(prisma, a.id, 10);
    await seedStock(prisma, b.id, 0); // second line has no stock
    const before = await tableCounts(prisma);

    await expect(
      saleService.createSale({
        paymentType: "CASH",
        items: [
          { productId: a.id, quantity: units(3) }, // valid line
          { productId: b.id, quantity: units(1) }, // out-of-stock line
        ],
      })
    ).rejects.toThrow();

    expect(await tableCounts(prisma)).toEqual(before);
  });

  it("R2 CREDIT sale for an unknown customer -> zero rows", async () => {
    const product = await createProduct(prisma, { name: "R2 Ghost Customer", unit: "pcs", costPrice: 2, currentPrice: 5 });
    await seedStock(prisma, product.id, 5);
    const before = await tableCounts(prisma);

    await expect(
      saleService.createSale({
        paymentType: "CREDIT",
        customerId: "00000000-0000-0000-0000-000000000000",
        items: [{ productId: product.id, quantity: units(1) }],
      })
    ).rejects.toThrow();

    expect(await tableCounts(prisma)).toEqual(before);
  });

  it("R3 purchase with an unknown product -> zero rows", async () => {
    const supplierId = await createSupplier(prisma, "R3 Ghost Product");
    const before = await tableCounts(prisma);

    await expect(
      purchaseService.createPurchase({
        supplierId,
        paymentType: "CASH",
        items: [{ productId: "00000000-0000-0000-0000-000000000000", quantity: units(1), costPerUnit: 5 }],
      })
    ).rejects.toThrow();

    expect(await tableCounts(prisma)).toEqual(before);
  });

  it("R4 DAMAGE above stock -> zero rows", async () => {
    const product = await createProduct(prisma, { name: "R4 Damage Overshoot", unit: "pcs", costPrice: 2, currentPrice: 5 });
    await seedStock(prisma, product.id, 1);
    const before = await tableCounts(prisma);

    await expect(
      stockService.adjustStock({ productId: product.id, reason: "DAMAGE", quantity: 5 })
    ).rejects.toThrow();

    expect(await tableCounts(prisma)).toEqual(before);
  });

  it("R5 customer payment linked to another customer's sale -> zero rows", async () => {
    const product = await createProduct(prisma, { name: "R5 Wrong Owner", unit: "pcs", costPrice: 2, currentPrice: 5 });
    const owner = await createCustomer(prisma, "R5 Owner");
    const payer = await createCustomer(prisma, "R5 Payer");
    await seedStock(prisma, product.id, 5);

    const sale = await saleService.createSale({
      paymentType: "CREDIT",
      customerId: owner,
      items: [{ productId: product.id, quantity: units(1) }],
    });
    const before = await tableCounts(prisma);

    await expect(
      customerPaymentService.createCustomerPayment({
        customerId: payer,
        amount: 10,
        saleId: sale.id,
      })
    ).rejects.toThrow();

    expect(await tableCounts(prisma)).toEqual(before);
  });

  it("R6 supplier payment for an unknown supplier -> zero rows", async () => {
    const before = await tableCounts(prisma);
    await expect(
      supplierPaymentService.createSupplierPayment({
        supplierId: "00000000-0000-0000-0000-000000000000",
        amount: 50,
      })
    ).rejects.toThrow();

    expect(await tableCounts(prisma)).toEqual(before);
  });

  it("R7 full success leaves no dead rows after reconcile", async () => {
    // Sanity: a happy multi-step lifecycle persists exactly the expected count.
    const product = await createProduct(prisma, { name: "R7 Lifecycle", unit: "pcs", costPrice: 2, currentPrice: 5 });
    const customerId = await createCustomer(prisma, "R7 Customer");
    const supplierId = await createSupplier(prisma, "R7 Supplier");
    await seedStock(prisma, product.id, 5);
    const before = await tableCounts(prisma);

    await purchaseService.createPurchase({
      supplierId,
      paymentType: "CASH",
      items: [{ productId: product.id, quantity: units(10), costPerUnit: 3 }],
    });
    await saleService.createSale({
      paymentType: "CREDIT",
      customerId,
      items: [{ productId: product.id, quantity: units(2) }],
    });
    await customerPaymentService.createCustomerPayment({ customerId, amount: 20 });

    const after = await tableCounts(prisma);
    expect(after.purchases).toBe(before.purchases + 1);
    expect(after.purchase_items).toBe(before.purchase_items + 1);
    expect(after.sales).toBe(before.sales + 1);
    expect(after.sale_items).toBe(before.sale_items + 1);
    expect(after.customers).toBe(before.customers);
    expect(after.suppliers).toBe(before.suppliers);
    expect(after.credit_payments).toBe(before.credit_payments + 1);
    expect(after.wallet_transactions).toBe(before.wallet_transactions + 2);
  });
});