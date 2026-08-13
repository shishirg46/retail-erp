export type PurchasePaymentType = "CASH" | "CREDIT";

export interface PurchaseItemInput {
  productId: string;
  quantity: number;
  costPerUnit: number;
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
  qty: number;
  costPerUnit: number;
}

export interface Purchase {
  id: string;
  supplierId: string;
  paymentType: PurchasePaymentType;
  total: number;
  date: Date;
  items: PurchaseItem[];
}

export interface CreatePurchaseRepositoryInput {
  supplierId: string;
  paymentType: PurchasePaymentType;
  total: number;
  items: {
    productId: string;
    qty: number;
    costPerUnit: number;
  }[];
}

export interface PurchaseRepository {
  create(input: CreatePurchaseRepositoryInput): Promise<Purchase>;
  findById(id: string): Promise<Purchase | null>;
  list(): Promise<Purchase[]>;
}