// Money is whole paisa in the domain (D11). Rupee values convert at the
// API boundary (routes out; suppliers accept no money on input).
export interface Supplier {
  id: string;
  name: string;
  contact: string | null;
  balanceOwed: number; // paisa; negative = shop prepaid the supplier
  openingBalance: number; // paisa; historical balance at ERP go-live (D26)
  createdAt: Date;
}

export interface CreateSupplierInput {
  name: string;
  contact?: string;
  openingBalance?: number; // paisa; optional, default 0 (D26)
}

export interface ListSuppliersInput {
  search?: string;
  cursor?: { date: Date; id: string };
  limit: number;
}

export interface SupplierRepository {
  create(input: CreateSupplierInput): Promise<Supplier>;
  findById(id: string): Promise<Supplier | null>;
  list(): Promise<Supplier[]>;
  listPaginated(input: ListSuppliersInput): Promise<Supplier[]>;
  // amountChange is signed and in paisa: positive = the shop owes more,
  // negative = money paid toward what the shop owes.
  updateBalance(id: string, amountChange: number): Promise<Supplier>;
}