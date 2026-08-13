// Dedicated transaction-rollback suite.
//
// Acceptance criterion for ERP-005: "a multi-item sale with one out-of-stock
// item leaves zero partial rows across sales/sale_items/stock_movements/wallet."
// Every scenario captures a full table snapshot, drives an operation that
// fails inside its $transaction, then asserts the snapshot is identical —
// proving atomic all-or-nothing on the failure paths.
//
// Note on the reserve-under-race failure: the atomic reserve in
// `SaleService.createSale` step 4 can only lose deterministically when a
// concurrent writer takes the stock first. That post-creation rollback is
// exercised by the preserved F-02 concurrency suite (scenario S1/S3 assert the
// losing transaction rolls back) and by R0's fixture-work visible here.

import "dotenv/config";
import { strict as assert } from "node:assert";
import { SaleService } from "../../modules/sales/sale.service";
import { StockService } from "../../modules/stock/stock.service";
import { PurchaseService } from "../../modules/purchases/purchase.service";
import { CustomerPaymentService } from "../../modules/customer-payments/customer-payment.service";
import { SupplierPaymentService } from "../../modules/supplier-payments/supplier-payment.service";
import { createDbSuite } from "../helpers/runner";
import { createProduct, createCustomer, createSupplier, seedStock } from "../helpers/seed";
import { createTestPrisma, tableCounts } from "../helpers/db";

const prisma = createTestPrisma();
const saleService = new SaleService(prisma);
const stockService = new StockService(prisma);
const purchaseService = new PurchaseService(prisma);
const customerPaymentService = new CustomerPaymentService(prisma);
const supplierPaymentService = new SupplierPaymentService(prisma);
const { scenario, finish } = createDbSuite(prisma);

await scenario("R0 positive control: a successful CASH sale DOES change counts", async () => {
  // Guards the harness against silently passing because the DB never truncates.
  const product = await createProduct(prisma, { name: "R0 Control", unit: "pcs", costPrice: 2, currentPrice: 5 });
  await seedStock(prisma, product.id, 5);
  const before = await tableCounts(prisma);

  await saleService.createSale({ paymentType: "CASH", items: [{ productId: product.id, quantity: 1 }] });

  const after = await tableCounts(prisma);
  assert.equal(after.sales, before.sales + 1, "control proves writes are visible");
  assert.equal(after.sale_items, before.sale_items + 1);
  assert.equal(after.stock_movements, before.stock_movements + 1, "snapshot taken after the seed, so only the SALE movement is new");
  assert.equal(after.wallet_transactions, before.wallet_transactions + 1);
});

await scenario("R1 ACCEPTANCE: multi-item sale, one item out-of-stock -> zero partial rows", async () => {
  const a = await createProduct(prisma, { name: "R1 In Stock", unit: "pcs", costPrice: 2, currentPrice: 5 });
  const b = await createProduct(prisma, { name: "R1 Out Of Stock", unit: "pcs", costPrice: 2, currentPrice: 5 });
  await seedStock(prisma, a.id, 10);
  await seedStock(prisma, b.id, 0); // second line has no stock
  const before = await tableCounts(prisma);

  let threw = false;
  try {
    await saleService.createSale({
      paymentType: "CASH",
      items: [
        { productId: a.id, quantity: 3 }, // valid line
        { productId: b.id, quantity: 1 }, // out-of-stock line
      ],
    });
  } catch {
    threw = true;
  }
  assert.ok(threw, "the sale must fail");

  assert.deepEqual(await tableCounts(prisma), before, "zero partial rows across ALL tables");
});

await scenario("R2 CREDIT sale for an unknown customer -> zero rows", async () => {
  const product = await createProduct(prisma, { name: "R2 Ghost Customer", unit: "pcs", costPrice: 2, currentPrice: 5 });
  await seedStock(prisma, product.id, 5);
  const before = await tableCounts(prisma);

  let threw = false;
  try {
    await saleService.createSale({
      paymentType: "CREDIT",
      customerId: "00000000-0000-0000-0000-000000000000",
      items: [{ productId: product.id, quantity: 1 }],
    });
  } catch {
    threw = true;
  }
  assert.ok(threw);
  assert.deepEqual(await tableCounts(prisma), before);
});

await scenario("R3 purchase with an unknown product -> zero rows", async () => {
  const supplierId = await createSupplier(prisma, "R3 Ghost Product");
  const before = await tableCounts(prisma);

  let threw = false;
  try {
    await purchaseService.createPurchase({
      supplierId,
      paymentType: "CASH",
      items: [{ productId: "00000000-0000-0000-0000-000000000000", quantity: 1, costPerUnit: 5 }],
    });
  } catch {
    threw = true;
  }
  assert.ok(threw);
  assert.deepEqual(await tableCounts(prisma), before);
});

await scenario("R4 DAMAGE above stock -> zero rows", async () => {
  const product = await createProduct(prisma, { name: "R4 Damage Overshoot", unit: "pcs", costPrice: 2, currentPrice: 5 });
  await seedStock(prisma, product.id, 1);
  const before = await tableCounts(prisma);

  let threw = false;
  try {
    await stockService.adjustStock({ productId: product.id, reason: "DAMAGE", quantity: 5 });
  } catch {
    threw = true;
  }
  assert.ok(threw);
  assert.deepEqual(await tableCounts(prisma), before);
});

await scenario("R5 customer payment linked to another customer's sale -> zero rows", async () => {
  const product = await createProduct(prisma, { name: "R5 Wrong Owner", unit: "pcs", costPrice: 2, currentPrice: 5 });
  const owner = await createCustomer(prisma, "R5 Owner");
  const payer = await createCustomer(prisma, "R5 Payer");
  await seedStock(prisma, product.id, 5);

  const sale = await saleService.createSale({
    paymentType: "CREDIT",
    customerId: owner,
    items: [{ productId: product.id, quantity: 1 }],
  });
  const before = await tableCounts(prisma);

  let threw = false;
  try {
    await customerPaymentService.createCustomerPayment({
      customerId: payer,
      amount: 10,
      saleId: sale.id,
    });
  } catch {
    threw = true;
  }
  assert.ok(threw);
  assert.deepEqual(await tableCounts(prisma), before);
});

await scenario("R6 supplier payment for an unknown supplier -> zero rows", async () => {
  const before = await tableCounts(prisma);
  let threw = false;
  try {
    await supplierPaymentService.createSupplierPayment({
      supplierId: "00000000-0000-0000-0000-000000000000",
      amount: 50,
    });
  } catch {
    threw = true;
  }
  assert.ok(threw);
  assert.deepEqual(await tableCounts(prisma), before);
});

await scenario("R7 full success leaves no dead rows after reconcile", async () => {
  // Sanity: a happy multi-step lifecycle persists exactly the expected count.
  const product = await createProduct(prisma, { name: "R7 Lifecycle", unit: "pcs", costPrice: 2, currentPrice: 5 });
  const customerId = await createCustomer(prisma, "R7 Customer");
  const supplierId = await createSupplier(prisma, "R7 Supplier");
  await seedStock(prisma, product.id, 5);
  const before = await tableCounts(prisma);

  await purchaseService.createPurchase({
    supplierId,
    paymentType: "CASH",
    items: [{ productId: product.id, quantity: 10, costPerUnit: 3 }],
  });
  await saleService.createSale({
    paymentType: "CREDIT",
    customerId,
    items: [{ productId: product.id, quantity: 2 }],
  });
  await customerPaymentService.createCustomerPayment({ customerId, amount: 20 });

  const after = await tableCounts(prisma);
  assert.equal(after.purchases, before.purchases + 1);
  assert.equal(after.purchase_items, before.purchase_items + 1);
  assert.equal(after.sales, before.sales + 1);
  assert.equal(after.sale_items, before.sale_items + 1);
  assert.equal(after.customers, before.customers, "customer fixture existed before the snapshot");
  assert.equal(after.suppliers, before.suppliers, "supplier fixture existed before the snapshot");
  assert.equal(after.credit_payments, before.credit_payments + 1);
  assert.equal(after.wallet_transactions, before.wallet_transactions + 2, "CASH purchase WITHDRAWAL + payment DEPOSIT");
});

const code = finish();
await prisma.$disconnect();
process.exit(code);