-- Pre-Phase-D Data-Model Foundation (D26/D27/D28)
-- Adds: opening balances for customers/suppliers, shop settings,
-- OPENING stock reason, and unitsPerPack for packaged products.

-- 1. Customer opening balance (D26)
ALTER TABLE "customers" ADD COLUMN "opening_balance" DECIMAL(12,2) NOT NULL DEFAULT 0;

-- 2. Supplier opening balance (D26)
ALTER TABLE "suppliers" ADD COLUMN "opening_balance" DECIMAL(12,2) NOT NULL DEFAULT 0;

-- 3. Product unitsPerPack (D28)
ALTER TABLE "products" ADD COLUMN "units_per_pack" INTEGER;

-- 4. StockReason enum: add OPENING (D27)
ALTER TYPE "StockReason" ADD VALUE 'OPENING';

-- 5. Shop settings singleton table (D26)
CREATE TABLE "shop_settings" (
    "id" TEXT NOT NULL DEFAULT 'singleton',
    "go_live_at" TIMESTAMPTZ NOT NULL,
    "wallet_opening_balance" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT "shop_settings_pkey" PRIMARY KEY ("id")
);
