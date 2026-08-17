import type { VoidInfo } from "../voids/void.types";

// Money is whole paisa in the domain (D11). Rupee values convert at the
// API boundary (validators in, routes out).
//
// Quantities are integer hundredths (scaled units) in the domain (D25.6) —
// the quantity analogue of whole paisa. Human quantities (≤ 2 dp) convert
// to/from scaled units via lib/quantity.ts at the boundaries.
export type PaymentType = "CASH" | "ECASH" | "CREDIT";

export interface SaleItemInput {
  productId: string;
  quantity: number; // scaled units (100 = 1 human unit)
}

export interface CreateSaleInput {
  paymentType: PaymentType;
  customerId?: string;
  items: SaleItemInput[];
}

// Internal pricing draft computed by the service, before persistence.
export interface SaleItemDraft {
  productId: string;
  quantity: number; // scaled units
  // Effective charged price at the time of sale (total / quantity, whole
  // paisa per human unit), frozen for history — never recalculated from
  // current product price.
  unitPrice: number; // paisa
  total: number; // paisa — authoritative line total from calculatePrice
}

export interface SaleItem {
  id: string;
  saleId: string;
  productId: string;
  productName: string;
  qty: number; // scaled units
  pricePerUnit: number; // paisa per human unit (informational, D1)
  lineTotal: number; // paisa — authoritative line total from calculatePrice (D1+)
}

export interface Sale {
  id: string;
  customerId: string | null;
  paymentType: PaymentType;
  total: number; // paisa
  date: Date;
  items: SaleItem[];
  voidInfo: VoidInfo;
}

export interface CreateSaleRepositoryInput {
  paymentType: PaymentType;
  customerId?: string;
  total: number;
  items: {
    productId: string;
    qty: number; // scaled units
    pricePerUnit: number;
    lineTotal: number; // paisa — authoritative line total
  }[];
}

export interface ListSalesInput {
  paymentType?: PaymentType;
  cursor?: { date: Date; id: string };
  limit: number;
}

export interface SaleRepository {
  create(input: CreateSaleRepositoryInput): Promise<Sale>;
  findById(id: string): Promise<Sale | null>;
  list(): Promise<Sale[]>;
  listPaginated(input: ListSalesInput): Promise<Sale[]>;
}