import { NextRequest, NextResponse } from "next/server";

import { requireRole, CASHIER, OWNER } from "@/lib/auth/authorize";
import { prisma } from "@/lib/prisma";
import { toHttpResponse } from "@/lib/response";
import { PrismaCustomerRepository } from "@/modules/customers/customer.repository";
import { toCustomerApi } from "@/modules/customers/customer.mapper";
import { CustomerService } from "@/modules/customers/customer.service";

type Context = { params: Promise<{ id: string }> };

export async function GET(req: NextRequest, context: Context) {
  try {
    await requireRole(req, [OWNER, CASHIER]);
    const { id } = await context.params;

    const customer = await new CustomerService(
      new PrismaCustomerRepository(prisma)
    ).findCustomerById(id);

    if (!customer) {
      return NextResponse.json({ message: "Customer not found" }, { status: 404 });
    }

    return NextResponse.json(toCustomerApi(customer));
  } catch (error) {
    return toHttpResponse(error);
  }
}