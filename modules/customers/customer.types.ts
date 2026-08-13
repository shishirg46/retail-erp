export interface Customer {
  id: string;
  name: string;
  contact: string | null;
  balanceOwed: number;
  createdAt: Date;
}

export interface CreateCustomerInput {
  name: string;
  contact?: string;
}

export interface CustomerRepository {
  create(input: CreateCustomerInput): Promise<Customer>;
  findById(id: string): Promise<Customer | null>;
  list(): Promise<Customer[]>;
  // amountChange is signed: positive = customer owes more,
  // negative = customer pays down their balance (may go below zero
  // into prepaid credit — see D4).
  updateBalance(id: string, amountChange: number): Promise<Customer>;
}