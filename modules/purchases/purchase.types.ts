import type { VoidInfo } from "../voids/void.types";

// Money is whole paisa in the domain (D11). Rupee values convert at the
// API boundary (validators in, routes out).
//
// Quantities are integer hundredths (scaled units) in the domain (D25.6) —
// the quantity analogue of whole paisa. Human quantities (≤ 2 dp) convert
// to/from scaled units via lib/quantity.ts at the boundaries.
export type PurchasePaymentType = "CASH" | "CREDIT";

export interface PurchaseItemInput {
  productId: string;
  quantity: number; // scaled units
  costPerUnit: number; // paisa per human unit
}

export interface CreatePurchaseInput {
  supplierId: string;
  paymentType: PurchasePaymentType;
  items: PurchaseItemInput[];
}

export interface PurchaseItem {
  id: string;
  purchaseId: string;
  productId: string;
  productName: string;
  qty: number; // scaled units
  costPerUnit: number; // paisa per human unit
}

export interface Purchase {
  id: string;
  supplierId: string;
  paymentType: PurchasePaymentType;
  total: number; // paisa
  date: Date;
  items: PurchaseItem[];
  voidInfo: VoidInfo;
}

export interface CreatePurchaseRepositoryInput {
  supplierId: string;
  paymentType: PurchasePaymentType;
  total: number;
  items: {
    productId: string;
    qty: number; // scaled units
    costPerUnit: number;
  }[];
}

export interface ListPurchasesInput {
  paymentType?: PurchasePaymentType;
  supplierId?: string;
  cursor?: { date: Date; id: string };
  limit: number;
}

export interface PurchaseRepository {
  create(input: CreatePurchaseRepositoryInput): Promise<Purchase>;
  findById(id: string): Promise<Purchase | null>;
  list(): Promise<Purchase[]>;
  listPaginated(input: ListPurchasesInput): Promise<Purchase[]>;
}