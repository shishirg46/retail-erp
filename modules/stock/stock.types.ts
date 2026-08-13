export type StockReason = "PURCHASE" | "SALE" | "DAMAGE" | "CORRECTION";

// Manual adjustments only ever use these two reasons (D6).
export type StockAdjustmentReason = "DAMAGE" | "CORRECTION";

export interface StockMovement {
  id: string;
  productId: string;
  qtyChange: number;
  reason: StockReason;
  date: Date;
  note: string | null;
}

export interface CreateStockMovementInput {
  productId: string;
  qtyChange: number;
  reason: StockReason;
  note?: string;
}

// DAMAGE:  quantity = amount damaged (applied as -quantity)
// CORRECTION: quantity = desired final stock level (change = target - current)
export interface AdjustStockInput {
  productId: string;
  reason: StockAdjustmentReason;
  quantity: number;
  note?: string;
}

export interface AdjustStockResult {
  product: { id: string; stockQty: number };
  movement: StockMovement;
}

export interface StockRepository {
  createMovement(input: CreateStockMovementInput): Promise<StockMovement>;
  listByProduct(productId: string): Promise<StockMovement[]>;
  list(): Promise<StockMovement[]>;
}