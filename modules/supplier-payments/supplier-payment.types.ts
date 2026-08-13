export interface SupplierPayment {
  id: string;
  supplierId: string;
  amount: number;
  date: Date;
}

export interface CreateSupplierPaymentInput {
  supplierId: string;
  amount: number;
}

export interface SupplierPaymentRepository {
  create(input: CreateSupplierPaymentInput): Promise<SupplierPayment>;
  list(): Promise<SupplierPayment[]>;
}