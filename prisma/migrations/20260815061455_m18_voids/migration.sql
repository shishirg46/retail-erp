-- M18 (ERP-009): transaction void / correction milestone.
--   * VOID reasons/sources for offsetting reversal ledger records
--   * explicit origin FKs on wallet_transactions (purchase_id, supplier_payment_id)
--     and stock_movements (sale_id, purchase_id) — no note-based matching
--   * void_records audit table (D18.7), unique per (target_type, target_id) (D18.11)

-- AlterEnum
ALTER TYPE "WalletTxnSource" ADD VALUE 'VOID';

-- AlterEnum
ALTER TYPE "StockReason" ADD VALUE 'VOID';

-- CreateTable
CREATE TABLE "void_records" (
    "id" TEXT NOT NULL,
    "target_type" TEXT NOT NULL,
    "target_id" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "note" TEXT,
    "voided_by" TEXT NOT NULL,
    "voided_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "void_records_pkey" PRIMARY KEY ("id")
);

-- AlterTable
ALTER TABLE "stock_movements" ADD COLUMN     "sale_id" TEXT;
ALTER TABLE "stock_movements" ADD COLUMN     "purchase_id" TEXT;

-- AlterTable
ALTER TABLE "wallet_transactions" ADD COLUMN     "purchase_id" TEXT;
ALTER TABLE "wallet_transactions" ADD COLUMN     "supplier_payment_id" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "void_records_target_type_target_id_unique" ON "void_records"("target_type", "target_id");

-- CreateIndex
CREATE INDEX "void_records_target_type_target_id_idx" ON "void_records"("target_type", "target_id");

-- CreateIndex
CREATE INDEX "stock_movements_sale_id_idx" ON "stock_movements"("sale_id");

-- CreateIndex
CREATE INDEX "stock_movements_purchase_id_idx" ON "stock_movements"("purchase_id");

-- CreateIndex
CREATE INDEX "wallet_transactions_purchase_id_idx" ON "wallet_transactions"("purchase_id");

-- CreateIndex
CREATE INDEX "wallet_transactions_supplier_payment_id_idx" ON "wallet_transactions"("supplier_payment_id");

-- AddForeignKey
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_sale_id_fkey" FOREIGN KEY ("sale_id") REFERENCES "sales"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_purchase_id_fkey" FOREIGN KEY ("purchase_id") REFERENCES "purchases"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "wallet_transactions" ADD CONSTRAINT "wallet_transactions_purchase_id_fkey" FOREIGN KEY ("purchase_id") REFERENCES "purchases"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "wallet_transactions" ADD CONSTRAINT "wallet_transactions_supplier_payment_id_fkey" FOREIGN KEY ("supplier_payment_id") REFERENCES "supplier_payments"("id") ON DELETE SET NULL ON UPDATE CASCADE;
