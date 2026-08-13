import type { Supplier } from "./supplier.types";
import type { CreateSupplierInput } from "./supplier.types";
import type { SupplierRepository } from "./supplier.types";

export class SupplierService {
  constructor(private readonly repository: SupplierRepository) {}

  async createSupplier(input: CreateSupplierInput): Promise<Supplier> {
    return this.repository.create(input);
  }

  async findSupplierById(id: string): Promise<Supplier | null> {
    return this.repository.findById(id);
  }

  async listSuppliers(): Promise<Supplier[]> {
    return this.repository.list();
  }
}