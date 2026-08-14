import { NextRequest, NextResponse } from "next/server";

import { requireRole, CASHIER, OWNER } from "@/lib/auth/authorize";
import { prisma } from "@/lib/prisma";
import { toHttpResponse } from "@/lib/response";
import { PrismaCustomerRepository } from "@/modules/customers/customer.repository";
import { CustomerService } from "@/modules/customers/customer.service";
import { validateCreateCustomerInput } from "@/modules/customers/customer.validation";

export async function POST(req: NextRequest) {
  try {
    await requireRole(req, [OWNER, CASHIER]);
    let body: unknown;

    try {
      body = await req.json();
    } catch {
      return NextResponse.json({ message: "Invalid JSON body" }, { status: 400 });
    }

    const input = validateCreateCustomerInput(body);

    const customer = await new CustomerService(
      new PrismaCustomerRepository(prisma)
    ).createCustomer(input);

    return NextResponse.json(customer, { status: 201 });
  } catch (error) {
    return toHttpResponse(error);
  }
}

export async function GET(req: NextRequest) {
  try {
    await requireRole(req, [OWNER, CASHIER]);
    const customers = await new CustomerService(
      new PrismaCustomerRepository(prisma)
    ).listCustomers();

    return NextResponse.json(customers);
  } catch (error) {
    return toHttpResponse(error);
  }
}