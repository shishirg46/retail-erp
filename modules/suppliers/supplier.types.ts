export interface Supplier {
  id: string;
  name: string;
  contact: string | null;
  balanceOwed: number;
  createdAt: Date;
}

export interface CreateSupplierInput {
  name: string;
  contact?: string;
}

export interface SupplierRepository {
  create(input: CreateSupplierInput): Promise<Supplier>;
  findById(id: string): Promise<Supplier | null>;
  list(): Promise<Supplier[]>;
  // amountChange is signed: positive = the shop owes more,
  // negative = money paid toward what the shop owes.
  updateBalance(id: string, amountChange: number): Promise<Supplier>;
}