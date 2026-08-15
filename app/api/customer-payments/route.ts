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
import { CustomerPaymentService } from "@/modules/customer-payments/customer-payment.service";
import { toCreditPaymentApi } from "@/modules/customer-payments/customer-payment.repository";
import { validateCreateCustomerPaymentInput } from "@/modules/customer-payments/customer-payment.validation";

export async function POST(req: NextRequest) {
  try {
    await requireRole(req, [OWNER, CASHIER]);
    let body: unknown;

    try {
      body = await req.json();
    } catch {
      return NextResponse.json({ message: "Invalid JSON body" }, { status: 400 });
    }

    const input = validateCreateCustomerPaymentInput(body);

    const payment = await new CustomerPaymentService(prisma).createCustomerPayment(
      input
    );

    return NextResponse.json(toCreditPaymentApi(payment), { status: 201 });
  } catch (error) {
    return toHttpResponse(error);
  }
}

export async function GET(req: NextRequest) {
  try {
    await requireRole(req, [OWNER, CASHIER]);
    const { searchParams } = req.nextUrl;
    const service = new CustomerPaymentService(prisma);

    const hasPaginationParam =
      searchParams.has("cursor") ||
      searchParams.has("limit") ||
      searchParams.has("customerId");

    if (!hasPaginationParam) {
      const payments = await service.listCustomerPayments();
      return NextResponse.json(payments.map(toCreditPaymentApi));
    }

    const { cursor, limit } = parsePaginationParams(searchParams);
    const customerId = parseStringFilter(searchParams, "customerId");

    const payments = await service.listCustomerPaymentsPaginated({
      customerId,
      cursor: cursor ?? undefined,
      limit,
    });

    const response = buildPaginatedResponse(
      payments,
      limit,
      (item) => encodeCursor(item.date, item.id)
    );

    return NextResponse.json({
      data: response.data.map(toCreditPaymentApi),
      paging: response.paging,
    });
  } catch (error) {
    return toHttpResponse(error);
  }
}