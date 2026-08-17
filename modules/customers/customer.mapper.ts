import type { Customer as CustomerModel } from "../../generated/prisma/client";
import { paisaFromDecimal, paisaToRupees } from "../../lib/money";

import type { Customer } from "./customer.types";

type RawCustomer = CustomerModel;

// Prisma stores money as Decimal rupees; the application domain works with
// whole paisa everywhere except at the repository boundary (D11).
export function toCustomer(raw: RawCustomer): Customer {
  return {
    id: raw.id,
    name: raw.name,
    contact: raw.contact,
    balanceOwed: paisaFromDecimal(raw.balanceOwed),
    openingBalance: paisaFromDecimal(raw.openingBalance),
    createdAt: raw.createdAt,
  };
}

// API output view: whole-paisa domain -> rupee wire representation (D11).
export function toCustomerApi(customer: Customer): Customer {
  return {
    ...customer,
    balanceOwed: paisaToRupees(customer.balanceOwed),
    openingBalance: paisaToRupees(customer.openingBalance),
  };
}