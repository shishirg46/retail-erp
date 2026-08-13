import { prisma } from "../../lib/prisma";

import { toCustomer } from "./customer.mapper";
import type { Customer, CustomerRepository, CreateCustomerInput } from "./customer.types";

type Db = {
  customer: typeof prisma.customer;
};

export class PrismaCustomerRepository implements CustomerRepository {
  constructor(private readonly db: Db = prisma) {}

  async create(input: CreateCustomerInput): Promise<Customer> {
    const raw = await this.db.customer.create({
      data: {
        name: input.name,
        contact: input.contact,
      },
    });

    return toCustomer(raw);
  }

  async findById(id: string): Promise<Customer | null> {
    const raw = await this.db.customer.findUnique({ where: { id } });

    return raw ? toCustomer(raw) : null;
  }

  async list(): Promise<Customer[]> {
    const raw = await this.db.customer.findMany({ orderBy: { createdAt: "desc" } });

    return raw.map(toCustomer);
  }

  async updateBalance(id: string, amountChange: number): Promise<Customer> {
    const raw = await this.db.customer.update({
      where: { id },
      data: { balanceOwed: { increment: amountChange } },
    });

    return toCustomer(raw);
  }
}