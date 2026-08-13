/*
  Warnings:

  - Added the required column `payment_type` to the `purchases` table without a default value. This is not possible if the table is not empty.

*/
-- CreateEnum
CREATE TYPE "PurchasePaymentType" AS ENUM ('CASH', 'CREDIT');

-- AlterEnum
ALTER TYPE "WalletTxnSource" ADD VALUE 'SUPPLIER_PAYMENT';

-- AlterTable
ALTER TABLE "purchases" ADD COLUMN     "payment_type" "PurchasePaymentType" NOT NULL;
