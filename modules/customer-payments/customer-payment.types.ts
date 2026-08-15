// Money is whole paisa in the domain (D11). Rupee values convert at the
// API boundary (validators in, routes out).
export interface CreditPayment {
  id: string;
  customerId: string;
  saleId: string | null;
  amount: number; // paisa
  date: Date;
}

export interface CreateCustomerPaymentInput {
  customerId: string;
  amount: number; // paisa
  // Optional traceability link to a CREDIT sale (D5). Does not change the
  // balance arithmetic — the payment always settles the overall balance.
  saleId?: string;
}

export interface CreateCreditPaymentRepositoryInput {
  customerId: string;
  amount: number;
  saleId: string | null;
}

export interface ListCreditPaymentsInput {
  customerId?: string;
  cursor?: { date: Date; id: string };
  limit: number;
}

export interface CreditPaymentRepository {
  create(input: CreateCreditPaymentRepositoryInput): Promise<CreditPayment>;
  list(): Promise<CreditPayment[]>;
  listPaginated(input: ListCreditPaymentsInput): Promise<CreditPayment[]>;
}