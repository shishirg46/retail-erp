import { NextRequest, NextResponse } from "next/server";

import { requireRole, CASHIER, OWNER } from "@/lib/auth/authorize";
import { prisma } from "@/lib/prisma";
import { toHttpResponse } from "@/lib/response";
import {
  parsePaginationParams,
  parseStringFilter,
  encodeCursor,
  buildPaginatedResponse,
} from "@/lib/pagination";
import { PrismaCustomerRepository } from "@/modules/customers/customer.repository";
import { toCustomerApi } from "@/modules/customers/customer.mapper";
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

    return NextResponse.json(toCustomerApi(customer), { status: 201 });
  } catch (error) {
    return toHttpResponse(error);
  }
}

export async function GET(req: NextRequest) {
  try {
    await requireRole(req, [OWNER, CASHIER]);
    const { searchParams } = req.nextUrl;

    const hasPaginationParam =
      searchParams.has("cursor") ||
      searchParams.has("limit") ||
      searchParams.has("search");

    const repository = new PrismaCustomerRepository(prisma);

    if (!hasPaginationParam) {
      const customers = await new CustomerService(repository).listCustomers();
      return NextResponse.json(customers.map(toCustomerApi));
    }

    const { cursor, limit } = parsePaginationParams(searchParams);
    const search = parseStringFilter(searchParams, "search");

    const customers = await repository.listPaginated({
      search,
      cursor: cursor ?? undefined,
      limit,
    });

    const response = buildPaginatedResponse(
      customers,
      limit,
      (item) => encodeCursor(item.createdAt, item.id)
    );

    return NextResponse.json({
      data: response.data.map(toCustomerApi),
      paging: response.paging,
    });
  } catch (error) {
    return toHttpResponse(error);
  }
}