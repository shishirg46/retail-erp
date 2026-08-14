// Money is whole paisa in the domain (D11). Rupee values convert at the
// API boundary (validators in, routes out).
export type PaymentType = "CASH" | "ECASH" | "CREDIT";

export interface SaleItemInput {
  productId: string;
  quantity: number;
}

export interface CreateSaleInput {
  paymentType: PaymentType;
  customerId?: string;
  items: SaleItemInput[];
}

// Internal pricing draft computed by the service, before persistence.
export interface SaleItemDraft {
  productId: string;
  quantity: number;
  // Effective charged price at the time of sale (total / quantity, whole
  // paisa), frozen for history — never recalculated from current product price.
  unitPrice: number; // paisa
  total: number; // paisa
}

export interface SaleItem {
  id: string;
  saleId: string;
  productId: string;
  qty: number;
  pricePerUnit: number; // paisa
}

export interface Sale {
  id: string;
  customerId: string | null;
  paymentType: PaymentType;
  total: number; // paisa
  date: Date;
  items: SaleItem[];
}

export interface CreateSaleRepositoryInput {
  paymentType: PaymentType;
  customerId?: string;
  total: number;
  items: {
    productId: string;
    qty: number;
    pricePerUnit: number;
  }[];
}

export interface SaleRepository {
  create(input: CreateSaleRepositoryInput): Promise<Sale>;
  findById(id: string): Promise<Sale | null>;
  list(): Promise<Sale[]>;
}