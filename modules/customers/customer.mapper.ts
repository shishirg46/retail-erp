import type { Customer as CustomerModel } from "../../generated/prisma/client";

import type { Customer } from "./customer.types";

type RawCustomer = CustomerModel;

// Prisma stores money as Decimal; the application works with number
// everywhere except at the repository boundary.
export function toCustomer(raw: RawCustomer): Customer {
  return {
    id: raw.id,
    name: raw.name,
    contact: raw.contact,
    balanceOwed: raw.balanceOwed.toNumber(),
    createdAt: raw.createdAt,
  };
}