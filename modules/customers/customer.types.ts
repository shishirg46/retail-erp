// Money is whole paisa in the domain (D11). Rupee values convert at the
// API boundary (routes out; customers accept no money on input).
export interface Customer {
  id: string;
  name: string;
  contact: string | null;
  balanceOwed: number; // paisa; negative = prepaid credit (D4)
  openingBalance: number; // paisa; historical balance at ERP go-live (D26)
  createdAt: Date;
}

export interface CreateCustomerInput {
  name: string;
  contact?: string;
  openingBalance?: number; // paisa; optional, default 0 (D26)
}

export interface ListCustomersInput {
  search?: string;
  cursor?: { date: Date; id: string };
  limit: number;
}

export interface CustomerRepository {
  create(input: CreateCustomerInput): Promise<Customer>;
  findById(id: string): Promise<Customer | null>;
  list(): Promise<Customer[]>;
  listPaginated(input: ListCustomersInput): Promise<Customer[]>;
  // amountChange is signed and in paisa: positive = customer owes more,
  // negative = customer pays down their balance (may go below zero
  // into prepaid credit — see D4).
  updateBalance(id: string, amountChange: number): Promise<Customer>;
}