// Money is whole paisa in the domain (D11). Rupee values convert at the
// API boundary (routes out; customers accept no money on input).
export interface Customer {
  id: string;
  name: string;
  contact: string | null;
  balanceOwed: number; // paisa; negative = prepaid credit (D4)
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
  // amountChange is signed and in paisa: positive = customer owes more,
  // negative = customer pays down their balance (may go below zero
  // into prepaid credit — see D4).
  updateBalance(id: string, amountChange: number): Promise<Customer>;
}