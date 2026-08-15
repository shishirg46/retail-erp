// M18 / D18 void integration suite (Vitest).
//
// Every test runs against the dedicated `erp_retail_test` database (refuses
// anything else), truncates first, and reconciles the D3/D4/D6/wallet ledger
// invariants after the body — the reconcile is void-aware, so it proves each
// void (and its VOID-source reversals) is internally consistent (D18.8).
//
// Covered:
//   - void CASH / ECASH sale   -> stock restored, VOID reversal movements,
//         wallet WITHDRAWAL (source VOID), originals never deleted
//   - void CREDIT sale         -> customer balance reversed, no wallet row
//   - void CASH purchase       -> stock removed (never negative), costPrice
//         re-derived (D18.5), wallet DEPOSIT (source VOID)
//   - void CREDIT purchase     -> supplier balance reversed
//   - void credit payment      -> customer balance restored, wallet reversed
//   - void supplier payment    -> supplier balance restored, wallet reversed
//   - void stock movement      -> DAMAGE/CORRECTION only; SALE/PURCHASE/VOID
//         reversals rejected; reversal never drives stock negative
//   - failures: 404 unknown target, 409 double void, business rules
//   - D18.8 reports exclude voided activity
//   - D18.9 repositories expose voidInfo; API mappers derive status

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  BusinessRuleError,
  ConflictError,
  InsufficientStockError,
  NotFoundError,
} from "../../lib/errors";
import { paisaFromDecimal } from "../../lib/money";
import { CustomerPaymentService } from "../../modules/customer-payments/customer-payment.service";
import { PrismaCustomerRepository } from "../../modules/customers/customer.repository";
import { PrismaProductRepository } from "../../modules/products/product.repository";
import { PurchaseService } from "../../modules/purchases/purchase.service";
import { PrismaReportRepository } from "../../modules/reports/report.repository";
import { ReportService } from "../../modules/reports/report.service";
import { SaleService } from "../../modules/sales/sale.service";
import { toSaleApi } from "../../modules/sales/sale.mapper";
import { StockService } from "../../modules/stock/stock.service";
import { PrismaSupplierRepository } from "../../modules/suppliers/supplier.repository";
import { SupplierPaymentService } from "../../modules/supplier-payments/supplier-payment.service";
import { VoidService } from "../../modules/voids/void.service";
import { createTestPrisma, truncateAll, reconcile } from "../helpers/db";
import {
  createCustomer,
  createProduct,
  createSupplier,
  seedStock,
} from "../helpers/seed";

const prisma = createTestPrisma();
const voidService = new VoidService(prisma);
const saleService = new SaleService(prisma);
const purchaseService = new PurchaseService(prisma);
const customerPaymentService = new CustomerPaymentService(prisma);
const supplierPaymentService = new SupplierPaymentService(prisma);
const stockService = new StockService(prisma);
const productRepository = new PrismaProductRepository(prisma);
const customerRepository = new PrismaCustomerRepository(prisma);
const supplierRepository = new PrismaSupplierRepository(prisma);

const VOIDED_BY = "00000000-0000-0000-0000-000000000001";
const input = { reason: "customer returned goods", voidedBy: VOIDED_BY };

async function expectError(
  fn: () => Promise<unknown>,
  ctor: new (...args: never[]) => Error,
  pattern?: RegExp
): Promise<void> {
  let threw: unknown;
  try {
    await fn();
  } catch (error) {
    threw = error;
  }
  expect(threw).toBeInstanceOf(ctor);
  if (pattern) expect((threw as Error).message).toMatch(pattern);
}

async function walletRows(): Promise<{ type: string; source: string; amount: number }[]> {
  const rows = await prisma.walletTransaction.findMany({
    orderBy: { date: "asc" },
  });
  return rows.map((row) => ({
    type: row.type,
    source: row.source,
    amount: paisaFromDecimal(row.amount),
  }));
}

describe("voids (M18/D18)", () => {
  beforeEach(async () => {
    await truncateAll(prisma);
  });

  afterEach(async () => {
    const violations = await reconcile(prisma);
    expect(violations.join("; ") || "ok").toBe("ok");
  });

  // ── Sale voids ─────────────────────────────────────────────────────────────
  it("V1 void CASH sale: stock restored, VOID reversal movements, wallet reversed", async () => {
    const product = await createProduct(prisma, { name: "V1 Rice", unit: "kg", costPrice: 1000, currentPrice: 2000 });
    await seedStock(prisma, product.id, 10);

    const sale = await saleService.createSale({
      paymentType: "CASH",
      items: [{ productId: product.id, quantity: 3 }],
    });
    expect(await productRepository.findById(product.id).then((p) => p!.stockQty)).toBe(7);

    const result = await voidService.voidSale(sale.id, input);

    expect(result.targetId).toBe(sale.id);
    expect(result.targetType).toBe("SALE");
    expect(result.reason).toBe("customer returned goods");

    // Original sale + items untouched.
    const kept = await prisma.sale.findUnique({ where: { id: sale.id } });
    expect(kept).not.toBeNull();
    expect(paisaFromDecimal(kept!.total)).toBe(6000);

    // Stock restored; reversal movement references the origin sale.
    expect(await productRepository.findById(product.id).then((p) => p!.stockQty)).toBe(10);
    const reversals = await prisma.stockMovement.findMany({
      where: { reason: "VOID", saleId: sale.id },
    });
    expect(reversals.length).toBe(1);
    expect(reversals[0].qtyChange).toBe(3);

    // Wallet: DEPOSIT (sale) + WITHDRAWAL (void) cancel.
    expect(await walletRows()).toEqual([
      { type: "DEPOSIT", source: "SALE", amount: 6000 },
      { type: "WITHDRAWAL", source: "VOID", amount: 6000 },
    ]);
  });

  it("V2 void CREDIT sale: customer balance reversed, no wallet rows", async () => {
    const product = await createProduct(prisma, { name: "V2 Tea", unit: "pcs", costPrice: 800, currentPrice: 1500 });
    const customerId = await createCustomer(prisma, "V2 Credit");
    await seedStock(prisma, product.id, 5);

    const sale = await saleService.createSale({
      paymentType: "CREDIT",
      customerId,
      items: [{ productId: product.id, quantity: 2 }], // +3000
    });
    expect(await customerRepository.findById(customerId).then((c) => c!.balanceOwed)).toBe(3000);

    await voidService.voidSale(sale.id, input);

    expect(await customerRepository.findById(customerId).then((c) => c!.balanceOwed)).toBe(0);
    expect(await prisma.walletTransaction.count()).toBe(0);
    expect(await productRepository.findById(product.id).then((p) => p!.stockQty)).toBe(5);
  });

  it("V3 sale with active linked credit payment cannot be voided (D18.4)", async () => {
    const product = await createProduct(prisma, { name: "V3 Linked", unit: "pcs", costPrice: 300, currentPrice: 600 });
    const customerId = await createCustomer(prisma, "V3 Payer");
    await seedStock(prisma, product.id, 10);

    const sale = await saleService.createSale({
      paymentType: "CREDIT",
      customerId,
      items: [{ productId: product.id, quantity: 5 }], // +3000
    });
    await customerPaymentService.createCustomerPayment({ customerId, amount: 2000, saleId: sale.id });

    await expectError(
      () => voidService.voidSale(sale.id, input),
      BusinessRuleError,
      /must be voided first/
    );

    // Void the payment first, then the sale succeeds.
    const payment = await prisma.creditPayment.findFirst({ where: { saleId: sale.id } });
    await voidService.voidCreditPayment(payment!.id, input);
    await voidService.voidSale(sale.id, input);
    expect(await customerRepository.findById(customerId).then((c) => c!.balanceOwed)).toBe(0);
  });

  it("V4 failure: double void -> 409 ConflictError", async () => {
    const product = await createProduct(prisma, { name: "V4 Double", unit: "pcs", costPrice: 100, currentPrice: 200 });
    await seedStock(prisma, product.id, 4);
    const sale = await saleService.createSale({
      paymentType: "CASH",
      items: [{ productId: product.id, quantity: 1 }],
    });

    await voidService.voidSale(sale.id, input);
    await expectError(
      () => voidService.voidSale(sale.id, input),
      ConflictError,
      /already voided/
    );
  });

  it("V5 failure: unknown sale -> 404, zero side effects", async () => {
    await expectError(
      () => voidService.voidSale("00000000-0000-0000-0000-000000000000", input),
      NotFoundError,
      /not found/
    );
    expect(await prisma.voidRecord.count()).toBe(0);
    expect(await prisma.stockMovement.count()).toBe(0);
    expect(await prisma.walletTransaction.count()).toBe(0);
  });

  // ── Purchase voids ─────────────────────────────────────────────────────────
  it("V6 void CASH purchase: stock removed, wallet reversed, cost re-derived", async () => {
    const product = await createProduct(prisma, { name: "V6 Flour", unit: "kg", costPrice: 500, currentPrice: 900 });
    const supplierId = await createSupplier(prisma, "V6 Mill");
    // Opening stock of 2, then a purchase of 8 -> 10.
    await seedStock(prisma, product.id, 2);
    await purchaseService.createPurchase({
      supplierId,
      paymentType: "CASH",
      items: [{ productId: product.id, quantity: 8, costPerUnit: 500 }],
    });
    expect(await productRepository.findById(product.id).then((p) => p!.stockQty)).toBe(10);
    expect(await productRepository.findById(product.id).then((p) => p!.costPrice)).toBe(500);

    const purchase = await purchaseService.findPurchaseById(
      (await prisma.purchase.findFirst())!.id
    );
    await voidService.voidPurchase(purchase!.id, input);

    // Stock back to the pre-purchase level; reversal movement references origin.
    expect(await productRepository.findById(product.id).then((p) => p!.stockQty)).toBe(2);
    const reversals = await prisma.stockMovement.findMany({
      where: { reason: "VOID", purchaseId: purchase!.id },
    });
    expect(reversals.length).toBe(1);
    expect(reversals[0].qtyChange).toBe(-8);

    // Wallet: WITHDRAWAL (purchase) + DEPOSIT (void) cancel.
    expect(await walletRows()).toEqual([
      { type: "WITHDRAWAL", source: "SUPPLIER_PAYMENT", amount: 4000 },
      { type: "DEPOSIT", source: "VOID", amount: 4000 },
    ]);
  });

  it("V7 void CASH purchase with no stock left to reverse -> 409 InsufficientStock", async () => {
    const product = await createProduct(prisma, { name: "V7 Spent", unit: "pcs", costPrice: 400, currentPrice: 800 });
    const supplierId = await createSupplier(prisma, "V7 Supplier");
    await purchaseService.createPurchase({
      supplierId,
      paymentType: "CASH",
      items: [{ productId: product.id, quantity: 5, costPerUnit: 400 }],
    });
    const purchase = await purchaseService.findPurchaseById(
      (await prisma.purchase.findFirst())!.id
    );
    // Consume the purchased stock.
    await saleService.createSale({
      paymentType: "CASH",
      items: [{ productId: product.id, quantity: 5 }],
    });
    expect(await productRepository.findById(product.id).then((p) => p!.stockQty)).toBe(0);

    await expectError(
      () => voidService.voidPurchase(purchase!.id, input),
      InsufficientStockError,
      /stock would make it negative|no longer has|negative/
    );
    // Nothing partial: no void record, no reversal movement.
    expect(await prisma.voidRecord.count()).toBe(0);
    expect(await prisma.stockMovement.count({ where: { reason: "VOID" } })).toBe(0);
  });

  it("V8 D18.5 cost re-derivation: void latest purchase, then void the remaining one", async () => {
    const product = await createProduct(prisma, { name: "V8 Cost", unit: "kg", costPrice: 0, currentPrice: 100 });
    const supplierId = await createSupplier(prisma, "V8 Supplier");
    await seedStock(prisma, product.id, 10);

    await purchaseService.createPurchase({
      supplierId,
      paymentType: "CASH",
      items: [{ productId: product.id, quantity: 2, costPerUnit: 100 }],
    });
    await purchaseService.createPurchase({
      supplierId,
      paymentType: "CASH",
      items: [{ productId: product.id, quantity: 2, costPerUnit: 200 }],
    });
    // UUID ids are not time-sortable, so identify the purchases by their cost.
    const [p1, p2] = (await prisma.purchase.findMany({ include: { items: true } }))
      .sort((a, b) => paisaFromDecimal(a.items[0].costPerUnit) - paisaFromDecimal(b.items[0].costPerUnit))
      .map((p) => p.id);
    expect(await productRepository.findById(product.id).then((p) => p!.costPrice)).toBe(200);

    // Void the latest purchase: cost falls back to the remaining non-voided one.
    await voidService.voidPurchase(p2, input);
    expect(await productRepository.findById(product.id).then((p) => p!.costPrice)).toBe(100);

    // Void the last one: no non-voided purchase history remains -> 0.
    await voidService.voidPurchase(p1, input);
    expect(await productRepository.findById(product.id).then((p) => p!.costPrice)).toBe(0);
  });

  it("V9 void CREDIT purchase: supplier balance reversed", async () => {
    const product = await createProduct(prisma, { name: "V9 Credit", unit: "pcs", costPrice: 300, currentPrice: 600 });
    const supplierId = await createSupplier(prisma, "V9 Supplier");
    await seedStock(prisma, product.id, 5);

    const purchase = await purchaseService.createPurchase({
      supplierId,
      paymentType: "CREDIT",
      items: [{ productId: product.id, quantity: 4, costPerUnit: 300 }],
    });
    expect(await supplierRepository.findById(supplierId).then((s) => s!.balanceOwed)).toBe(1200);

    await voidService.voidPurchase(purchase.id, input);
    expect(await supplierRepository.findById(supplierId).then((s) => s!.balanceOwed)).toBe(0);
    expect(await prisma.walletTransaction.count()).toBe(0);
  });

  // ── Payment voids ──────────────────────────────────────────────────────────
  it("V10 void credit payment: customer balance restored, wallet reversed", async () => {
    const customerId = await createCustomer(prisma, "V10 Payer");
    const payment = await customerPaymentService.createCustomerPayment({ customerId, amount: 2000 });
    expect(await customerRepository.findById(customerId).then((c) => c!.balanceOwed)).toBe(-2000);

    await voidService.voidCreditPayment(payment.id, input);

    expect(await customerRepository.findById(customerId).then((c) => c!.balanceOwed)).toBe(0);
    expect(await walletRows()).toEqual([
      { type: "DEPOSIT", source: "CREDIT_PAYMENT", amount: 2000 },
      { type: "WITHDRAWAL", source: "VOID", amount: 2000 },
    ]);
  });

  it("V11 void supplier payment: supplier balance restored, wallet reversed", async () => {
    const supplierId = await createSupplier(prisma, "V11 Supplier");
    const payment = await supplierPaymentService.createSupplierPayment({ supplierId, amount: 1500 });
    expect(await supplierRepository.findById(supplierId).then((s) => s!.balanceOwed)).toBe(-1500);

    await voidService.voidSupplierPayment(payment.id, input);

    expect(await supplierRepository.findById(supplierId).then((s) => s!.balanceOwed)).toBe(0);
    expect(await walletRows()).toEqual([
      { type: "WITHDRAWAL", source: "SUPPLIER_PAYMENT", amount: 1500 },
      { type: "DEPOSIT", source: "VOID", amount: 1500 },
    ]);
  });

  it("V12 payment to a voided sale is rejected (D18.4)", async () => {
    const product = await createProduct(prisma, { name: "V12 Voided", unit: "pcs", costPrice: 300, currentPrice: 600 });
    const customerId = await createCustomer(prisma, "V12 Customer");
    await seedStock(prisma, product.id, 5);

    const sale = await saleService.createSale({
      paymentType: "CREDIT",
      customerId,
      items: [{ productId: product.id, quantity: 1 }],
    });
    await voidService.voidSale(sale.id, input);

    await expectError(
      () => customerPaymentService.createCustomerPayment({ customerId, amount: 500, saleId: sale.id }),
      BusinessRuleError,
      /voided/
    );
  });

  // ── Stock movement voids ───────────────────────────────────────────────────
  it("V13 void CORRECTION movement: reversal restores stock", async () => {
    const product = await createProduct(prisma, { name: "V13 Adj", unit: "pcs", costPrice: 1, currentPrice: 2 });
    await stockService.adjustStock({
      productId: product.id,
      reason: "CORRECTION",
      quantity: 7,
      note: "count fix",
    });
    expect(await productRepository.findById(product.id).then((p) => p!.stockQty)).toBe(7);

    const movement = (await prisma.stockMovement.findFirst({ where: { reason: "CORRECTION" } }))!;
    await voidService.voidStockMovement(movement.id, input);

    expect(await productRepository.findById(product.id).then((p) => p!.stockQty)).toBe(0);
    const reversal = await prisma.stockMovement.findFirst({
      where: { reason: "VOID", note: { contains: movement.id } },
    });
    expect(reversal).not.toBeNull();
    expect(reversal!.qtyChange).toBe(-7);
  });

  it("V14 void DAMAGE movement: reversal adds the damaged quantity back", async () => {
    const product = await createProduct(prisma, { name: "V14 Damage", unit: "kg", costPrice: 10, currentPrice: 20 });
    await seedStock(prisma, product.id, 5);
    await stockService.adjustStock({
      productId: product.id,
      reason: "DAMAGE",
      quantity: 2,
      note: "spilled",
    });
    expect(await productRepository.findById(product.id).then((p) => p!.stockQty)).toBe(3);

    const movement = (await prisma.stockMovement.findFirst({ where: { reason: "DAMAGE" } }))!;
    await voidService.voidStockMovement(movement.id, input);
    expect(await productRepository.findById(product.id).then((p) => p!.stockQty)).toBe(5);
  });

  it("V15 movement rules: SALE/PURCHASE/VOID movements cannot be voided directly", async () => {
    const product = await createProduct(prisma, { name: "V15 Rules", unit: "pcs", costPrice: 10, currentPrice: 20 });
    await seedStock(prisma, product.id, 5);

    await saleService.createSale({
      paymentType: "CASH",
      items: [{ productId: product.id, quantity: 1 }],
    });
    const saleMovement = await prisma.stockMovement.findFirst({ where: { reason: "SALE" } });
    await expectError(
      () => voidService.voidStockMovement(saleMovement!.id, input),
      BusinessRuleError,
      /void the originating sale/
    );

    const supplierId = await createSupplier(prisma, "V15 Supplier");
    await purchaseService.createPurchase({
      supplierId,
      paymentType: "CASH",
      items: [{ productId: product.id, quantity: 2, costPerUnit: 10 }],
    });
    const purchaseMovement = await prisma.stockMovement.findFirst({ where: { reason: "PURCHASE" } });
    await expectError(
      () => voidService.voidStockMovement(purchaseMovement!.id, input),
      BusinessRuleError,
      /void the originating purchase/
    );

    const correction = await stockService.adjustStock({
      productId: product.id,
      reason: "CORRECTION",
      quantity: 5,
      note: "fix",
    });
    await voidService.voidStockMovement(correction.movement.id, input);
    const reversal = await prisma.stockMovement.findFirst({
      where: { reason: "VOID", note: { contains: correction.movement.id } },
    });
    await expectError(
      () => voidService.voidStockMovement(reversal!.id, input),
      BusinessRuleError,
      /void reversal/
    );
    expect(await prisma.sale.count()).toBe(1);
  });

  it("V16 void reversal that drives stock negative -> 409", async () => {
    const product = await createProduct(prisma, { name: "V16 Neg", unit: "pcs", costPrice: 10, currentPrice: 20 });
    // CORRECTION raises stock from 0 to 3...
    await stockService.adjustStock({
      productId: product.id,
      reason: "CORRECTION",
      quantity: 3,
      note: "raise",
    });
    // ...and the stock is sold off before the void.
    await saleService.createSale({
      paymentType: "CASH",
      items: [{ productId: product.id, quantity: 3 }],
    });
    expect(await productRepository.findById(product.id).then((p) => p!.stockQty)).toBe(0);

    // Reversing the CORRECTION must REMOVE 3 from an empty product.
    const correction = (await prisma.stockMovement.findFirst({
      where: { reason: "CORRECTION", note: "raise" },
    }))!;
    await expectError(
      () => voidService.voidStockMovement(correction.id, input),
      InsufficientStockError,
      /negative/
    );
  });

  // ── Reports exclude voided activity (D18.8) ───────────────────────────────
  it("V17 reports drop voided sales, purchases, payments and reversal rows", async () => {
    const reportService = new ReportService(new PrismaReportRepository(prisma));

    const product = await createProduct(prisma, { name: "V17 Goods", unit: "pcs", costPrice: 500, currentPrice: 1000 });
    const customerId = await createCustomer(prisma, "V17 Customer");
    const supplierId = await createSupplier(prisma, "V17 Supplier");
    await seedStock(prisma, product.id, 20);

    // Build two of everything: one kept, one voided.
    await saleService.createSale({
      paymentType: "CASH",
      items: [{ productId: product.id, quantity: 1 }], // 1000
    });
    const voidedSale = await saleService.createSale({
      paymentType: "CASH",
      items: [{ productId: product.id, quantity: 2 }], // 2000
    });
    await purchaseService.createPurchase({
      supplierId,
      paymentType: "CASH",
      items: [{ productId: product.id, quantity: 3, costPerUnit: 500 }],
    });
    const voidedPurchase = await purchaseService.createPurchase({
      supplierId,
      paymentType: "CASH",
      items: [{ productId: product.id, quantity: 4, costPerUnit: 500 }],
    });
    await customerPaymentService.createCustomerPayment({ customerId, amount: 1000 });
    const voidedPayment = await customerPaymentService.createCustomerPayment({ customerId, amount: 2000 });
    await supplierPaymentService.createSupplierPayment({ supplierId, amount: 1000 });
    const voidedSupplierPayment = await supplierPaymentService.createSupplierPayment({ supplierId, amount: 2000 });

    const before = await reportService.salesReport({});
    expect(before.numberOfSales).toBe(2);
    expect(before.totalSales).toBe(30);

    await voidService.voidSale(voidedSale.id, input);
    await voidService.voidPurchase(voidedPurchase.id, input);
    await voidService.voidCreditPayment(voidedPayment.id, input);
    await voidService.voidSupplierPayment(voidedSupplierPayment.id, input);

    // Sales report: only the kept sale remains. Report money is in rupees (D11).
    const sales = await reportService.salesReport({});
    expect(sales.numberOfSales).toBe(1);
    expect(sales.totalSales).toBe(10);
    expect(sales.byPaymentType.find((r) => r.paymentType === "CASH")!.total).toBe(10);
    expect(sales.productQuantities.find((r) => r.productId === product.id)!.quantity).toBe(1);

    // Purchases report: only the kept purchase remains.
    const purchases = await reportService.purchasesReport({});
    expect(purchases.numberOfPurchases).toBe(1);
    expect(purchases.totalPurchases).toBe(15);

    // Customers report: only the kept payment counts.
    const customers = await reportService.customersReport({});
    expect(customers.paymentHistory[0].totalPaid).toBe(10);
    expect(customers.paymentHistory[0].count).toBe(1);

    // Suppliers report: only the kept payment counts.
    const suppliers = await reportService.suppliersReport({});
    expect(suppliers.paymentHistory[0].totalPaid).toBe(10);
    expect(suppliers.paymentHistory[0].count).toBe(1);

    // Wallet report: reversal rows carry source VOID, so nothing from the
    // voided transactions appears at all — every group reflects only kept
    // activity. SUPPLIER_PAYMENT covers both CASH-purchase withdrawals (15)
    // and the kept supplier payment (10).
    const wallet = await reportService.walletReport({});
    const source = (s: string): { deposits: number; withdrawals: number } =>
      wallet.bySource.find((g) => g.source === s) ?? { deposits: 0, withdrawals: 0 };
    expect(source("SALE").deposits).toBe(10);
    expect(source("CREDIT_PAYMENT").deposits).toBe(10);
    expect(source("SUPPLIER_PAYMENT").withdrawals).toBe(25);
    expect(source("VOID")).toEqual({ deposits: 0, withdrawals: 0 });
    // Kept activity nets to -5: +10 sale, +10 credit payment, -15 purchase, -10 supplier payment.
    expect(wallet.balance).toBe(-5);

    // Stock report: reversal movements excluded from the movement summary;
    // kept activity only.
    const stock = await reportService.stockReport({});
    const summary = stock.movementSummary;
    const byReason = (reason: string): number =>
      summary.find((r) => r.reason === reason)?.quantity ?? 0;
    expect(byReason("SALE")).toBe(-1);
    expect(byReason("PURCHASE")).toBe(3);
    expect(byReason("VOID")).toBe(0);
  });

  // ── Status exposure (D18.9) ────────────────────────────────────────────────
  it("V18 repositories expose voidInfo; API mappers derive status", async () => {
    const product = await createProduct(prisma, { name: "V18 Status", unit: "pcs", costPrice: 10, currentPrice: 20 });
    await seedStock(prisma, product.id, 5);

    const active = await saleService.createSale({
      paymentType: "CASH",
      items: [{ productId: product.id, quantity: 1 }],
    });
    const viaRepo = await saleService.findSaleById(active.id);
    expect(viaRepo!.voidInfo.voidedAt).toBeNull();
    expect(toSaleApi(viaRepo!).status).toBe("ACTIVE");

    await voidService.voidSale(active.id, input);

    const voided = await saleService.findSaleById(active.id);
    expect(voided!.voidInfo.voidedAt).not.toBeNull();
    expect(voided!.voidInfo.reason).toBe("customer returned goods");
    const api = toSaleApi(voided!);
    expect(api.status).toBe("VOIDED");
    expect(api.voidReason).toBe("customer returned goods");
    expect(api.voidedAt).toEqual(voided!.voidInfo.voidedAt);
  });
});
