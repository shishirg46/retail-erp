-- D25 (M22): Fractional quantities — unit-driven precision and an
-- integer-scaled (hundredths) quantity domain.
--
-- Widen all five quantity columns from INTEGER to DECIMAL(18,2). Existing
-- whole-number rows convert losslessly (they are all integers, which DECIMAL
-- represents exactly). The 2-decimal scale enforces the maximum precision
-- (D25.2) at the DB layer: Postgres rounds anything finer, so the validators
-- and services stay the authority for rejecting >2-dp input (D25.1).

ALTER TABLE "products" ALTER COLUMN "stock_qty" TYPE DECIMAL(18,2);
ALTER TABLE "price_tiers" ALTER COLUMN "min_qty" TYPE DECIMAL(18,2);
ALTER TABLE "sale_items" ALTER COLUMN "qty" TYPE DECIMAL(18,2);
ALTER TABLE "purchase_items" ALTER COLUMN "qty" TYPE DECIMAL(18,2);
ALTER TABLE "stock_movements" ALTER COLUMN "qty_change" TYPE DECIMAL(18,2);

-- Relax the three whole-number-only positivity CHECKs to plain positivity so
-- fractional quantities are legal:
--   * price_tiers.min_qty  >= 1  -> > 0   (fractional thresholds, D25.4)
--   * sale_items.qty       >= 1  -> > 0   (0.25 kg sales, D25)
--   * purchase_items.qty   >= 1  -> > 0
ALTER TABLE "price_tiers" DROP CONSTRAINT "price_tiers_min_qty_positive";
ALTER TABLE "price_tiers" ADD CONSTRAINT "price_tiers_min_qty_positive" CHECK ("min_qty" > 0);
ALTER TABLE "sale_items" DROP CONSTRAINT "sale_items_qty_positive";
ALTER TABLE "sale_items" ADD CONSTRAINT "sale_items_qty_positive" CHECK ("qty" > 0);
ALTER TABLE "purchase_items" DROP CONSTRAINT "purchase_items_qty_positive";
ALTER TABLE "purchase_items" ADD CONSTRAINT "purchase_items_qty_positive" CHECK ("qty" > 0);

-- D25.1: products.unit is frozen to the supported set — controlled rather than
-- arbitrary free-text. Enforced here and in the product validator.
--
-- Data migration: pre-existing products with a unit outside the set (e.g. the
-- dev fixture "pack") are mapped to the nearest countable unit, `pcs`. This is
-- a one-time, conservative reclassification of the handful of existing rows;
-- real deployments should confirm their unit vocabulary before applying.
UPDATE "products" SET "unit" = 'pcs' WHERE "unit" NOT IN ('pcs', 'kg', 'g', 'liter', 'ml');
ALTER TABLE "products" ADD CONSTRAINT "products_unit_supported" CHECK ("unit" IN ('pcs', 'kg', 'g', 'liter', 'ml'));

-- D25.1 pcs-integer backstop: a pcs product can never carry a fractional stock
-- level — products carries its own unit on the same row, so this is expressible
-- as a plain CHECK. The child tables (price_tiers / sale_items / purchase_items
-- / stock_movements) cannot reference the product's unit inside a CHECK, so
-- their unit precision rule lives in the services/validators (authoritative);
-- the DECIMAL(18,2) scale above is their DB-level precision backstop.
ALTER TABLE "products" ADD CONSTRAINT "products_stock_qty_pcs_integer" CHECK ("unit" <> 'pcs' OR "stock_qty" = floor("stock_qty"));
