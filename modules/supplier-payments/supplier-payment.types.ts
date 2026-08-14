// Money is whole paisa in the domain (D11). Rupee values convert at the
// API boundary (validators in, routes out).
export interface SupplierPayment {
  id: string;
  supplierId: string;
  amount: number; // paisa
  date: Date;
}

export interface CreateSupplierPaymentInput {
  supplierId: string;
  amount: number; // paisa
}

export interface SupplierPaymentRepository {
  create(input: CreateSupplierPaymentInput): Promise<SupplierPayment>;
  list(): Promise<SupplierPayment[]>;
}