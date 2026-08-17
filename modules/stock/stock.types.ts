import type { VoidInfo } from "../voids/void.types";

// Quantities are integer hundredths (scaled units) in the domain (D25.6) —
// the quantity analogue of whole paisa. Human quantities (≤ 2 dp) convert
// to/from scaled units via lib/quantity.ts at the boundaries.

export type StockReason = "PURCHASE" | "SALE" | "DAMAGE" | "CORRECTION" | "VOID" | "OPENING";

// Manual adjustments: DAMAGE, CORRECTION, or OPENING (D6, D27).
export type StockAdjustmentReason = "DAMAGE" | "CORRECTION" | "OPENING";

export interface StockMovement {
  id: string;
  productId: string;
  productName: string;
  qtyChange: number; // scaled units (signed)
  reason: StockReason;
  date: Date;
  note: string | null;
  saleId: string | null;
  purchaseId: string | null;
  saleCustomerName: string | null;
  purchaseSupplierName: string | null;
  voidInfo: VoidInfo;
}

export interface CreateStockMovementInput {
  productId: string;
  qtyChange: number; // scaled units (signed)
  reason: StockReason;
  note?: string;
  saleId?: string;
  purchaseId?: string;
}

// DAMAGE:  quantity = amount damaged (applied as -quantity)
// CORRECTION: quantity = desired final stock level (change = target - current)
// OPENING: quantity = desired initial stock level (change = target - current, but
//   requires stockQty == 0 to prevent double-opening)
// All in scaled units.
export interface AdjustStockInput {
  productId: string;
  reason: StockAdjustmentReason;
  quantity: number; // scaled units
  note?: string;
}

export interface AdjustStockResult {
  product: { id: string; stockQty: number }; // scaled units
  movement: StockMovement;
}

export interface ListStockMovementsInput {
  productId?: string;
  reason?: StockReason;
  cursor?: { date: Date; id: string };
  limit: number;
}

export interface StockRepository {
  createMovement(input: CreateStockMovementInput): Promise<StockMovement>;
  findById(id: string): Promise<StockMovement | null>;
  listByProduct(productId: string): Promise<StockMovement[]>;
  list(): Promise<StockMovement[]>;
  listPaginated(input: ListStockMovementsInput): Promise<StockMovement[]>;
}