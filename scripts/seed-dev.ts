#!/usr/bin/env npx tsx
// M24 — Dev database initialization + realistic data seed.
//
// Idempotent: truncates all application + auth tables before seeding.
// Safe: refuses to run against test or production databases.
// Verifiable: independently re-derives all invariants from persisted DB records.
//
// Usage:
//   npx tsx scripts/seed-dev.ts          # seed + verify
//   npx tsx scripts/seed-dev.ts --dry    # print plan, don't touch DB

import { PrismaClient } from "../generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaProductRepository } from "../modules/products/product.repository";
import { PrismaCustomerRepository } from "../modules/customers/customer.repository";
import { PrismaSupplierRepository } from "../modules/suppliers/supplier.repository";
import { PrismaSettingsRepository } from "../modules/settings/settings.repository";
import { StockService } from "../modules/stock/stock.service";
import { PurchaseService } from "../modules/purchases/purchase.service";
import { SaleService } from "../modules/sales/sale.service";
import { CustomerPaymentService } from "../modules/customer-payments/customer-payment.service";
import { SupplierPaymentService } from "../modules/supplier-payments/supplier-payment.service";
import { VoidService } from "../modules/voids/void.service";
import { PrismaWalletRepository } from "../modules/wallet/wallet.repository";
import {
  PRODUCTS,
  SUPPLIERS,
  CUSTOMERS,
  SHOP_SETTINGS,
  PURCHASES,
  SALES,
  CREDIT_PAYMENTS,
  SUPPLIER_PAYMENTS,
  STOCK_ADJUSTMENTS,
  OWNER_WITHDRAWALS,
  VOIDS,
} from "./seed-dev-data";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Convert rupees (wire) to paisa (domain). */
function rp(amount: number): number {
  return Math.round(amount * 100);
}

/** Convert human units to scaled units (D25.6). */
function su(units: number): number {
  return Math.round(units * 100);
}

const DRY_RUN = process.argv.includes("--dry");

function log(msg: string): void {
  console.log(`  ${msg}`);
}

function heading(msg: string): void {
  console.log(`\n▸ ${msg}`);
}

// ---------------------------------------------------------------------------
// DB guard — refuse test / production
// ---------------------------------------------------------------------------

function resolveDevDbUrl(): string {
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error("DATABASE_URL is not set");
  }
  if (url.includes("erp_retail_test")) {
    throw new Error("Refusing to seed the TEST database (erp_retail_test). Set DATABASE_URL to the dev database.");
  }
  if (url.includes("production")) {
    throw new Error("Refusing to seed a PRODUCTION database. Set DATABASE_URL to the dev database.");
  }
  return url;
}

// ---------------------------------------------------------------------------
// Truncate all tables
// ---------------------------------------------------------------------------

async function truncateAll(db: PrismaClient): Promise<void> {
  await db.$executeRawUnsafe(`
    TRUNCATE TABLE
      "user",
      "session",
      "account",
      "verification",
      void_records,
      wallet_transactions,
      credit_payments,
      sale_items,
      sales,
      stock_movements,
      purchase_items,
      purchases,
      price_tiers,
      products,
      supplier_payments,
      suppliers,
      customers,
      shop_settings
    CASCADE
  `);
}

// ---------------------------------------------------------------------------
// Seed owner (Better Auth)
// ---------------------------------------------------------------------------

async function seedOwner(db: PrismaClient): Promise<void> {
  // Check if owner already exists
  const existing = await db.$queryRawUnsafe<unknown[]>(
    `SELECT id FROM "user" WHERE email = 'owner@erp.local' LIMIT 1`
  );
  if ((existing as { id: string }[]).length > 0) {
    log("OWNER user already exists — skipping");
    return;
  }

  // Hash password using the same scrypt as Better Auth
  const { hashPassword } = await import("@better-auth/utils/password");
  const username = process.env.SEED_OWNER_USERNAME || "owner";
  const email = `${username}@erp.local`;
  const password = process.env.SEED_OWNER_PASSWORD || "ownerpass123";
  const hashed = await hashPassword(password);

  const userId = crypto.randomUUID();
  const accountId = crypto.randomUUID();
  const now = new Date();

  await db.$executeRawUnsafe(
    `INSERT INTO "user" (id, name, email, "emailVerified", "createdAt", "updatedAt", username, role, banned)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
    userId, username, email, false, now, now, username, "OWNER", false
  );
  await db.$executeRawUnsafe(
    `INSERT INTO "account" (id, "accountId", "providerId", "userId", password, "createdAt", "updatedAt")
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    accountId, email, "credential", userId, hashed, now, now
  );

  log(`OWNER user seeded: ${email}`);
}

// ---------------------------------------------------------------------------
// Main seed flow
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  console.log("═══════════════════════════════════════════════════");
  console.log("  M24 — Dev Database Seed");
  console.log("═══════════════════════════════════════════════════");

  const dbUrl = resolveDevDbUrl();
  const dbMatch = dbUrl.match(/\/([^/?]+)(\?|$)/);
  const dbName = dbMatch ? dbMatch[1] : "unknown";
  console.log(`\n  Target database: ${dbName}`);
  console.log(`  Mode: ${DRY_RUN ? "DRY RUN (no changes)" : "SEED"}`);

  if (DRY_RUN) {
    console.log("\n  Dry run — printing plan only.\n");
    printPlan();
    return;
  }

  const adapter = new PrismaPg({ connectionString: dbUrl });
  const db = new PrismaClient({ adapter });

  try {
    // 1. Truncate
    heading("Truncating all tables");
    await truncateAll(db);
    log("All tables truncated");

    // 2. Auth owner
    heading("Seeding auth owner");
    await seedOwner(db);

    // 3. Shop settings
    heading("Seeding shop settings");
    const settingsRepo = new PrismaSettingsRepository(db);
    const settings = await settingsRepo.update({
      goLiveAt: SHOP_SETTINGS.goLiveAt,
      walletOpeningBalance: rp(SHOP_SETTINGS.walletOpeningBalance),
    });
    log(`goLiveAt: ${settings.goLiveAt.toISOString()}`);
    log(`walletOpeningBalance: Rs ${SHOP_SETTINGS.walletOpeningBalance}`);

    // 3b. Wallet opening deposit transaction (D26) — the wallet balance starts
    //     here. D18 expects ΣDEPOSITS to include this opening credit.
    const walletRepo = new PrismaWalletRepository(db);
    if (SHOP_SETTINGS.walletOpeningBalance > 0) {
      await walletRepo.create({
        type: "DEPOSIT",
        source: "OTHER",
        amount: rp(SHOP_SETTINGS.walletOpeningBalance),
        note: "Wallet opening balance at ERP go-live",
      });
      log(`wallet opening deposit: Rs ${SHOP_SETTINGS.walletOpeningBalance}`);
    }

    // 4. Products
    heading(`Seeding ${PRODUCTS.length} products`);
    const productRepo = new PrismaProductRepository(db);
    const productIds: string[] = [];
    for (const p of PRODUCTS) {
      const created = await productRepo.create({
        name: p.name,
        unit: p.unit,
        costPrice: rp(p.costPrice),
        currentPrice: rp(p.currentPrice),
        ...(p.unitsPerPack ? { unitsPerPack: p.unitsPerPack } : {}),
        ...(p.priceTiers
          ? { priceTiers: p.priceTiers.map((t) => ({ minQty: su(t.minQty), price: rp(t.price) })) }
          : {}),
      });
      productIds.push(created.id);
      log(`  ${created.name} (${p.unit}) — cost Rs ${p.costPrice}, price Rs ${p.currentPrice}${p.unitsPerPack ? `, ${p.unitsPerPack}/pack` : ""}`);
    }

    // 5. Opening stock (via StockService with reason OPENING)
    heading("Seeding opening stock (OPENING reason)");
    const stockService = new StockService(db);
    for (let i = 0; i < PRODUCTS.length; i++) {
      if (PRODUCTS[i].openingStock > 0) {
        await stockService.adjustStock({
          productId: productIds[i],
          reason: "OPENING",
          quantity: su(PRODUCTS[i].openingStock),
          note: `Opening stock at ERP go-live`,
        });
        log(`  ${PRODUCTS[i].name}: +${PRODUCTS[i].openingStock} ${PRODUCTS[i].unit}`);
      }
    }

    // 6. Suppliers
    heading(`Seeding ${SUPPLIERS.length} suppliers`);
    const supplierRepo = new PrismaSupplierRepository(db);
    const supplierIds: string[] = [];
    for (const s of SUPPLIERS) {
      const created = await supplierRepo.create({
        name: s.name,
        contact: s.contact,
        openingBalance: rp(s.openingBalance),
      });
      supplierIds.push(created.id);
      log(`  ${created.name} — opening Rs ${s.openingBalance}`);
    }

    // 7. Customers
    heading(`Seeding ${CUSTOMERS.length} customers`);
    const customerRepo = new PrismaCustomerRepository(db);
    const customerIds: string[] = [];
    for (const c of CUSTOMERS) {
      const created = await customerRepo.create({
        name: c.name,
        contact: c.contact,
        openingBalance: rp(c.openingBalance),
      });
      customerIds.push(created.id);
      log(`  ${created.name} — opening Rs ${c.openingBalance}`);
    }

    // 8. Purchases
    heading(`Seeding ${PURCHASES.length} purchases`);
    const purchaseService = new PurchaseService(db);
    const purchaseIds: string[] = [];
    for (const p of PURCHASES) {
      const created = await purchaseService.createPurchase({
        supplierId: supplierIds[p.supplierIndex],
        paymentType: p.paymentType,
        items: p.items.map((item) => ({
          productId: productIds[item.productIndex],
          quantity: su(item.quantity),
          costPerUnit: rp(item.costPerUnit),
        })),
      });
      purchaseIds.push(created.id);
      log(`  ${p.paymentType} purchase from ${SUPPLIERS[p.supplierIndex].name} — Rs ${created.total / 100} (${p.items.length} items, day +${p.dayOffset})`);
    }

    // 9. Sales
    heading(`Seeding ${SALES.length} sales`);
    const saleService = new SaleService(db);
    const saleIds: string[] = [];
    let saleCount = 0;
    for (const s of SALES) {
      const created = await saleService.createSale({
        paymentType: s.paymentType,
        customerId: s.customerIndex !== null ? customerIds[s.customerIndex] : undefined,
        items: s.items.map((item) => ({
          productId: productIds[item.productIndex],
          quantity: su(item.quantity),
        })),
      });
      saleIds.push(created.id);
      saleCount++;
      const customerLabel = s.customerIndex !== null ? CUSTOMERS[s.customerIndex].name : "walk-in";
      log(`  [${saleCount}/${SALES.length}] ${s.paymentType} sale to ${customerLabel} — Rs ${created.total / 100} (day +${s.dayOffset})`);
    }

    // 10. Credit payments
    heading(`Seeding ${CREDIT_PAYMENTS.length} credit payments`);
    const custPayService = new CustomerPaymentService(db);
    const creditPaymentIds: string[] = [];
    for (const cp of CREDIT_PAYMENTS) {
      const created = await custPayService.createCustomerPayment({
        customerId: customerIds[cp.customerIndex],
        amount: rp(cp.amount),
        ...(cp.saleIndex !== undefined ? { saleId: saleIds[cp.saleIndex] } : {}),
      });
      creditPaymentIds.push(created.id);
      const linked = cp.saleIndex !== undefined ? ` (linked to sale)` : "";
      log(`  Rs ${cp.amount} from ${CUSTOMERS[cp.customerIndex].name}${linked} (day +${cp.dayOffset})`);
    }

    // 11. Supplier payments
    heading(`Seeding ${SUPPLIER_PAYMENTS.length} supplier payments`);
    const supPayService = new SupplierPaymentService(db);
    const supplierPaymentIds: string[] = [];
    for (const sp of SUPPLIER_PAYMENTS) {
      const created = await supPayService.createSupplierPayment({
        supplierId: supplierIds[sp.supplierIndex],
        amount: rp(sp.amount),
      });
      supplierPaymentIds.push(created.id);
      log(`  Rs ${sp.amount} to ${SUPPLIERS[sp.supplierIndex].name} (day +${sp.dayOffset})`);
    }

    // 12. Stock adjustments (DAMAGE / CORRECTION)
    heading(`Seeding ${STOCK_ADJUSTMENTS.length} stock adjustments`);
    for (const adj of STOCK_ADJUSTMENTS) {
      await stockService.adjustStock({
        productId: productIds[adj.productIndex],
        reason: adj.reason,
        quantity: su(Math.abs(adj.quantity)),
        note: adj.note,
      });
      log(`  ${adj.reason} on ${PRODUCTS[adj.productIndex].name}: ${adj.quantity > 0 ? "+" : ""}${adj.quantity} ${PRODUCTS[adj.productIndex].unit}`);
    }

    // 13. OWNER_WITHDRAWAL
    heading(`Seeding ${OWNER_WITHDRAWALS.length} owner withdrawals`);
    for (const ow of OWNER_WITHDRAWALS) {
      await walletRepo.create({
        type: "WITHDRAWAL",
        source: "OWNER_WITHDRAWAL",
        amount: rp(ow.amount),
        note: ow.note,
      });
      log(`  Rs ${ow.amount} — ${ow.note} (day +${ow.dayOffset})`);
    }

    // 14. Voids
    heading(`Seeding ${VOIDS.length} voids`);
    const voidService = new VoidService(db);
    for (const v of VOIDS) {
      let voidedId: string;
      let description: string;

      switch (v.targetType) {
        case "SALE":
          voidedId = saleIds[v.targetIndex];
          description = `sale ${voidedId.slice(0, 8)}`;
          await voidService.voidSale(voidedId, {
            reason: v.reason,
            voidedBy: v.voidedBy,
          });
          break;
        case "CREDIT_PAYMENT":
          voidedId = creditPaymentIds[v.targetIndex];
          description = `credit payment ${voidedId.slice(0, 8)}`;
          await voidService.voidCreditPayment(voidedId, {
            reason: v.reason,
            voidedBy: v.voidedBy,
          });
          break;
        case "STOCK_MOVEMENT": {
          // Need to find the stock movement ID for the adjustment
          const adj = STOCK_ADJUSTMENTS[v.targetIndex];
          const movements = await db.stockMovement.findMany({
            where: {
              productId: productIds[adj.productIndex],
              reason: adj.reason,
            },
            orderBy: { date: "asc" },
          });
          if (movements.length === 0) {
            throw new Error(`No stock movement found for ${adj.reason} on ${PRODUCTS[adj.productIndex].name}`);
          }
          voidedId = movements[0].id;
          description = `stock movement ${voidedId.slice(0, 8)} (${adj.reason})`;
          await voidService.voidStockMovement(voidedId, {
            reason: v.reason,
            voidedBy: v.voidedBy,
          });
          break;
        }
        case "PURCHASE":
          voidedId = purchaseIds[v.targetIndex];
          description = `purchase ${voidedId.slice(0, 8)}`;
          await voidService.voidPurchase(voidedId, {
            reason: v.reason,
            voidedBy: v.voidedBy,
          });
          break;
      }

      log(`  Void ${v.targetType}: ${description} — "${v.reason}"`);
    }

    // 15. Verification
    heading("Verifying reconciliation invariants");
    const violations = await verifyInvariants(db);
    if (violations.length === 0) {
      log("✓ All invariants hold");
    } else {
      log(`✗ ${violations.length} violation(s):`);
      for (const v of violations) {
        log(`  ✗ ${v}`);
      }
    }

    // 16. Summary
    heading("Summary");
    await printSummary(db);
  } finally {
    await db.$disconnect();
  }
}

// ---------------------------------------------------------------------------
// Verification — independently derive expected values from persisted DB
// ---------------------------------------------------------------------------

async function verifyInvariants(db: PrismaClient): Promise<string[]> {
  const violations: string[] = [];
  const EPSILON = 1e-6;
  const close = (a: number, b: number) => Math.abs(a - b) < EPSILON;
  const toN = (v: unknown) => Number(v);

  // D6: stockQty == SUM(qtyChange) per product
  const products = await db.product.findMany({ include: { stockMovements: true } });
  for (const p of products) {
    const summed = p.stockMovements.reduce((s, m) => s + toN(m.qtyChange), 0);
    const stockQty = toN(p.stockQty);
    if (!close(stockQty, summed)) {
      violations.push(`D6 '${p.name}': stockQty=${stockQty} != Σmovements=${summed}`);
    }
  }

  // D4: balanceOwed == openingBalance + Σ(CREDIT sales) - Σ(credit payments) per customer
  const customers = await db.customer.findMany({ include: { sales: true, creditPayments: true } });
  const voidedSaleIds = new Set(
    (await db.voidRecord.findMany({ where: { targetType: "SALE" } })).map((v) => v.targetId)
  );
  const voidedPaymentIds = new Set(
    (await db.voidRecord.findMany({ where: { targetType: "CREDIT_PAYMENT" } })).map((v) => v.targetId)
  );

  for (const c of customers) {
    const creditSales = c.sales
      .filter((s) => s.paymentType === "CREDIT" && !voidedSaleIds.has(s.id))
      .reduce((s, x) => s + toN(x.total), 0);
    const paid = c.creditPayments
      .filter((x) => !voidedPaymentIds.has(x.id))
      .reduce((s, x) => s + toN(x.amount), 0);
    const opening = toN(c.openingBalance);
    const expected = opening + creditSales - paid;
    if (!close(toN(c.balanceOwed), expected)) {
      violations.push(`D4 '${c.name}': balanceOwed=${toN(c.balanceOwed)} != ${expected}`);
    }
  }

  // D3: balanceOwed == openingBalance + Σ(CREDIT purchases) - Σ(supplier payments) per supplier
  const suppliers = await db.supplier.findMany({ include: { purchases: true, supplierPayments: true } });
  const voidedPurchaseIds = new Set(
    (await db.voidRecord.findMany({ where: { targetType: "PURCHASE" } })).map((v) => v.targetId)
  );
  const voidedSupPayIds = new Set(
    (await db.voidRecord.findMany({ where: { targetType: "SUPPLIER_PAYMENT" } })).map((v) => v.targetId)
  );

  for (const s of suppliers) {
    const creditPurchases = s.purchases
      .filter((p) => p.paymentType === "CREDIT" && !voidedPurchaseIds.has(p.id))
      .reduce((sum, x) => sum + toN(x.total), 0);
    const paid = s.supplierPayments
      .filter((x) => !voidedSupPayIds.has(x.id))
      .reduce((sum, x) => sum + toN(x.amount), 0);
    const opening = toN(s.openingBalance);
    const expected = opening + creditPurchases - paid;
    if (!close(toN(s.balanceOwed), expected)) {
      violations.push(`D3 '${s.name}': balanceOwed=${toN(s.balanceOwed)} != ${expected}`);
    }
  }

  // D18: wallet invariant
  const walletWithdrawals = await db.walletTransaction.findMany({ where: { type: "WITHDRAWAL" } });
  const walletDeposits = await db.walletTransaction.findMany({ where: { type: "DEPOSIT" } });
  const actualWithdrawals = walletWithdrawals.reduce((s, x) => s + toN(x.amount), 0);
  const actualDeposits = walletDeposits.reduce((s, x) => s + toN(x.amount), 0);

  // Re-derive expected from ledger
  const allSales = await db.sale.findMany();
  const allPurchases = await db.purchase.findMany();
  const allCustPayments = await db.creditPayment.findMany();
  const allSupPayments = await db.supplierPayment.findMany();

  const nonCreditSales = allSales.filter((s) => s.paymentType !== "CREDIT");
  const cashPurchases = allPurchases.filter((p) => p.paymentType === "CASH");
  const voidedCashPurchases = cashPurchases.filter((p) => voidedPurchaseIds.has(p.id));
  const voidedSupPayRows = allSupPayments.filter((x) => voidedSupPayIds.has(x.id));
  const voidedNonCreditSales = nonCreditSales.filter((s) => voidedSaleIds.has(s.id));
  const voidedCustPayRows = allCustPayments.filter((x) => voidedPaymentIds.has(x.id));
  const ownerWithdrawals = walletWithdrawals.filter((w) => w.source === "OWNER_WITHDRAWAL");

  // expectedDeposits: all ledger sources that generate wallet DEPOSIT rows.
  // The wallet opening balance is represented as an OTHER DEPOSIT transaction
  // (seeded in step 3b). The ledger-only query below doesn't include it, so
  // we add walletOpening separately to match actualDeposits.
  let walletOpening = 0;
  try {
    const settingsRow = await db.shopSettings.findUnique({ where: { id: "singleton" } });
    if (settingsRow) walletOpening = toN(settingsRow.walletOpeningBalance);
  } catch { /* ignore */ }

  const expectedDeposits =
    nonCreditSales.reduce((s, x) => s + toN(x.total), 0) +
    allCustPayments.reduce((s, x) => s + toN(x.amount), 0) +
    voidedCashPurchases.reduce((s, x) => s + toN(x.total), 0) +
    voidedSupPayRows.reduce((s, x) => s + toN(x.amount), 0) +
    walletOpening;

  const expectedWithdrawals =
    cashPurchases.reduce((s, x) => s + toN(x.total), 0) +
    allSupPayments.reduce((s, x) => s + toN(x.amount), 0) +
    voidedNonCreditSales.reduce((s, x) => s + toN(x.total), 0) +
    voidedCustPayRows.reduce((s, x) => s + toN(x.amount), 0) +
    ownerWithdrawals.reduce((s, x) => s + toN(x.amount), 0);

  if (!close(actualDeposits, expectedDeposits)) {
    violations.push(`D18 deposits: actual=${actualDeposits} != expected=${expectedDeposits}`);
  }
  if (!close(actualWithdrawals, expectedWithdrawals)) {
    violations.push(`D18 withdrawals: actual=${actualWithdrawals} != expected=${expectedWithdrawals}`);
  }

  // Sale line total consistency: SUM(sale_items.lineTotal) == sale.total per sale
  const salesWithItems = await db.sale.findMany({ include: { items: true } });
  for (const sale of salesWithItems) {
    const itemsSum = sale.items.reduce((s, item) => s + toN(item.lineTotal), 0);
    if (!close(toN(sale.total), itemsSum)) {
      violations.push(`Sale ${sale.id.slice(0, 8)}: total=${toN(sale.total)} != ΣlineTotal=${itemsSum}`);
    }
  }

  return violations;
}

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------

async function printSummary(db: PrismaClient): Promise<void> {
  const counts: Record<string, number> = {};
  const tables = [
    "products", "price_tiers", "customers", "suppliers",
    "purchases", "purchase_items", "sales", "sale_items",
    "stock_movements", "credit_payments", "supplier_payments",
    "wallet_transactions", "void_records", "shop_settings",
  ] as const;

  for (const table of tables) {
    const rows = await db.$queryRawUnsafe<[{ c: number }]>(
      `SELECT COUNT(*)::int AS c FROM "${table}"`
    );
    counts[table] = rows[0].c;
  }

  console.log("\n  Table row counts:");
  for (const [table, count] of Object.entries(counts)) {
    console.log(`    ${table.padEnd(22)} ${count}`);
  }

  // Wallet balance
  const walletDeposits = await db.$queryRawUnsafe<[{ s: number }]>(
    `SELECT COALESCE(SUM(amount), 0)::float AS s FROM wallet_transactions WHERE type = 'DEPOSIT'`
  );
  const walletWithdrawals = await db.$queryRawUnsafe<[{ s: number }]>(
    `SELECT COALESCE(SUM(amount), 0)::float AS s FROM wallet_transactions WHERE type = 'WITHDRAWAL'`
  );
  const settingsRow = await db.shopSettings.findUnique({ where: { id: "singleton" } });
  const opening = settingsRow ? Number(settingsRow.walletOpeningBalance) : 0;
  const balance = opening + Number(walletDeposits[0].s) - Number(walletWithdrawals[0].s);

  console.log(`\n  Wallet balance: Rs ${balance / 100} (opening Rs ${opening / 100} + deposits Rs ${Number(walletDeposits[0].s) / 100} - withdrawals Rs ${Number(walletWithdrawals[0].s) / 100})`);
}

// ---------------------------------------------------------------------------
// Dry-run plan
// ---------------------------------------------------------------------------

function printPlan(): void {
  console.log("  Products:", PRODUCTS.length);
  console.log("  Suppliers:", SUPPLIERS.length);
  console.log("  Customers:", CUSTOMERS.length);
  console.log("  Purchases:", PURCHASES.length);
  console.log("  Sales:", SALES.length);
  console.log("  Credit payments:", CREDIT_PAYMENTS.length);
  console.log("  Supplier payments:", SUPPLIER_PAYMENTS.length);
  console.log("  Stock adjustments:", STOCK_ADJUSTMENTS.length);
  console.log("  Owner withdrawals:", OWNER_WITHDRAWALS.length);
  console.log("  Voids:", VOIDS.length);
  console.log("  Shop settings: goLiveAt =", SHOP_SETTINGS.goLiveAt.toISOString(), ", walletOpeningBalance =", SHOP_SETTINGS.walletOpeningBalance);
}

// ---------------------------------------------------------------------------
// Run
// ---------------------------------------------------------------------------

main().catch((err) => {
  console.error("\n✗ Seed failed:", err);
  process.exit(1);
});
