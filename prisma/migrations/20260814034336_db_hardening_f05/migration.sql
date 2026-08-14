-- CreateIndex
CREATE INDEX "credit_payments_customer_id_date_idx" ON "credit_payments"("customer_id", "date");

-- CreateIndex
CREATE INDEX "purchase_items_purchase_id_idx" ON "purchase_items"("purchase_id");

-- CreateIndex
CREATE INDEX "purchases_date_idx" ON "purchases"("date");

-- CreateIndex
CREATE INDEX "sale_items_sale_id_idx" ON "sale_items"("sale_id");

-- CreateIndex
CREATE INDEX "sales_date_idx" ON "sales"("date");

-- CreateIndex
CREATE INDEX "stock_movements_product_id_date_idx" ON "stock_movements"("product_id", "date");

-- CreateIndex
CREATE INDEX "stock_movements_date_idx" ON "stock_movements"("date");

-- CreateIndex
CREATE INDEX "supplier_payments_supplier_id_date_idx" ON "supplier_payments"("supplier_id", "date");

-- CreateIndex
CREATE INDEX "wallet_transactions_date_idx" ON "wallet_transactions"("date");

-- F-05 (ERP-006): DB CHECK constraints — defense-in-depth backstops.
-- Every constraint below restates a rule already enforced by the services and
-- validators (D1-D8); existing data was validated before migration
-- (scripts/validate-f05-preconditions.mjs) so no row is rejected.

-- Non-negativity / positivity backstops.
ALTER TABLE "products" ADD CONSTRAINT "products_stock_qty_nonnegative" CHECK ("stock_qty" >= 0);
ALTER TABLE "products" ADD CONSTRAINT "products_cost_price_nonnegative" CHECK ("cost_price" >= 0);
ALTER TABLE "products" ADD CONSTRAINT "products_current_price_positive" CHECK ("current_price" > 0);
ALTER TABLE "price_tiers" ADD CONSTRAINT "price_tiers_min_qty_positive" CHECK ("min_qty" >= 1);
ALTER TABLE "price_tiers" ADD CONSTRAINT "price_tiers_price_positive" CHECK ("price" > 0);
ALTER TABLE "sale_items" ADD CONSTRAINT "sale_items_qty_positive" CHECK ("qty" >= 1);
ALTER TABLE "sale_items" ADD CONSTRAINT "sale_items_price_per_unit_nonnegative" CHECK ("price_per_unit" >= 0);
ALTER TABLE "purchase_items" ADD CONSTRAINT "purchase_items_qty_positive" CHECK ("qty" >= 1);
ALTER TABLE "purchase_items" ADD CONSTRAINT "purchase_items_cost_per_unit_nonnegative" CHECK ("cost_per_unit" >= 0);
ALTER TABLE "sales" ADD CONSTRAINT "sales_total_positive" CHECK ("total" > 0);
ALTER TABLE "purchases" ADD CONSTRAINT "purchases_total_nonnegative" CHECK ("total" >= 0);
ALTER TABLE "credit_payments" ADD CONSTRAINT "credit_payments_amount_positive" CHECK ("amount" > 0);
ALTER TABLE "supplier_payments" ADD CONSTRAINT "supplier_payments_amount_positive" CHECK ("amount" > 0);
ALTER TABLE "wallet_transactions" ADD CONSTRAINT "wallet_transactions_amount_nonnegative" CHECK ("amount" >= 0);

-- Stock-movement sign semantics per reason (D6). qty_change stays signed by
-- design (PURCHASE in, SALE/DAMAGE out, CORRECTION +/-/0) and CORRECTION is
-- deliberately unconstrained (a no-op CORRECTION legitimately writes 0).
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_purchase_qty_positive" CHECK ("reason" <> 'PURCHASE' OR "qty_change" > 0);
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_sale_qty_negative" CHECK ("reason" <> 'SALE' OR "qty_change" < 0);
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_damage_qty_negative" CHECK ("reason" <> 'DAMAGE' OR "qty_change" < 0);
