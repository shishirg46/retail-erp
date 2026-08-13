export interface CreditPayment {
  id: string;
  customerId: string;
  saleId: string | null;
  amount: number;
  date: Date;
}

export interface CreateCustomerPaymentInput {
  customerId: string;
  amount: number;
  // Optional traceability link to a CREDIT sale (D5). Does not change the
  // balance arithmetic — the payment always settles the overall balance.
  saleId?: string;
}

export interface CreateCreditPaymentRepositoryInput {
  customerId: string;
  amount: number;
  saleId: string | null;
}

export interface CreditPaymentRepository {
  create(input: CreateCreditPaymentRepositoryInput): Promise<CreditPayment>;
  list(): Promise<CreditPayment[]>;
}