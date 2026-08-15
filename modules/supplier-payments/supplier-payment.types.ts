import type { VoidInfo } from "../voids/void.types";

// Money is whole paisa in the domain (D11). Rupee values convert at the
// API boundary (validators in, routes out).
export interface SupplierPayment {
  id: string;
  supplierId: string;
  amount: number; // paisa
  date: Date;
  voidInfo: VoidInfo;
}

export interface CreateSupplierPaymentInput {
  supplierId: string;
  amount: number; // paisa
}

export interface ListSupplierPaymentsInput {
  supplierId?: string;
  cursor?: { date: Date; id: string };
  limit: number;
}

export interface SupplierPaymentRepository {
  create(input: CreateSupplierPaymentInput): Promise<SupplierPayment>;
  findById(id: string): Promise<SupplierPayment | null>;
  list(): Promise<SupplierPayment[]>;
  listPaginated(input: ListSupplierPaymentsInput): Promise<SupplierPayment[]>;
}