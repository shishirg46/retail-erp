import type { Customer, CreateCustomerInput, CustomerRepository } from "./customer.types";

// Customer CRUD is mostly persistence passthrough — keep this service thin.
export class CustomerService {
  constructor(private readonly repository: CustomerRepository) {}

  async createCustomer(input: CreateCustomerInput): Promise<Customer> {
    return this.repository.create(input);
  }

  async findCustomerById(id: string): Promise<Customer | null> {
    return this.repository.findById(id);
  }

  async listCustomers(): Promise<Customer[]> {
    return this.repository.list();
  }
}