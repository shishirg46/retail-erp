import { NextRequest, NextResponse } from "next/server";

import { requireRole, OWNER } from "@/lib/auth/authorize";
import { prisma } from "@/lib/prisma";
import { toHttpResponse } from "@/lib/response";
import {
  parsePaginationParams,
  parseStringFilter,
  encodeCursor,
  buildPaginatedResponse,
} from "@/lib/pagination";
import { SupplierPaymentService } from "@/modules/supplier-payments/supplier-payment.service";
import { toSupplierPaymentApi } from "@/modules/supplier-payments/supplier-payment.repository";
import { validateCreateSupplierPaymentInput } from "@/modules/supplier-payments/supplier-payment.validation";

export async function POST(req: NextRequest) {
  try {
    await requireRole(req, [OWNER]);
    let body: unknown;

    try {
      body = await req.json();
    } catch {
      return NextResponse.json({ message: "Invalid JSON body" }, { status: 400 });
    }

    const input = validateCreateSupplierPaymentInput(body);

    const payment = await new SupplierPaymentService(
      prisma
    ).createSupplierPayment(input);

    return NextResponse.json(toSupplierPaymentApi(payment), { status: 201 });
  } catch (error) {
    return toHttpResponse(error);
  }
}

export async function GET(req: NextRequest) {
  try {
    await requireRole(req, [OWNER]);
    const { searchParams } = req.nextUrl;
    const service = new SupplierPaymentService(prisma);

    const hasPaginationParam =
      searchParams.has("cursor") ||
      searchParams.has("limit") ||
      searchParams.has("supplierId");

    if (!hasPaginationParam) {
      const payments = await service.listSupplierPayments();
      return NextResponse.json(payments.map(toSupplierPaymentApi));
    }

    const { cursor, limit } = parsePaginationParams(searchParams);
    const supplierId = parseStringFilter(searchParams, "supplierId");

    const payments = await service.listSupplierPaymentsPaginated({
      supplierId,
      cursor: cursor ?? undefined,
      limit,
    });

    const response = buildPaginatedResponse(
      payments,
      limit,
      (item) => encodeCursor(item.date, item.id)
    );

    return NextResponse.json({
      data: response.data.map(toSupplierPaymentApi),
      paging: response.paging,
    });
  } catch (error) {
    return toHttpResponse(error);
  }
}