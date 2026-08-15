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
import { SaleService } from "@/modules/sales/sale.service";
import { toSaleApi } from "@/modules/sales/sale.mapper";
import { validateCreateSaleInput } from "@/modules/sales/sale.validation";

export async function POST(req: NextRequest) {
  try {
    await requireRole(req, [OWNER, CASHIER]);
    let body: unknown;

    try {
      body = await req.json();
    } catch {
      return NextResponse.json({ message: "Invalid JSON body" }, { status: 400 });
    }

    const input = validateCreateSaleInput(body);

    const sale = await new SaleService(prisma).createSale(input);

    return NextResponse.json(toSaleApi(sale), { status: 201 });
  } catch (error) {
    return toHttpResponse(error);
  }
}

export async function GET(req: NextRequest) {
  try {
    await requireRole(req, [OWNER, CASHIER]);
    const { searchParams } = req.nextUrl;
    const service = new SaleService(prisma);

    const hasPaginationParam =
      searchParams.has("cursor") ||
      searchParams.has("limit") ||
      searchParams.has("paymentType");

    if (!hasPaginationParam) {
      const sales = await service.listSales();
      return NextResponse.json(sales.map(toSaleApi));
    }

    const { cursor, limit } = parsePaginationParams(searchParams);
    const paymentType = parseStringFilter(searchParams, "paymentType");

    const sales = await service.listSalesPaginated({
      paymentType: paymentType as import("@/modules/sales/sale.types").PaymentType | undefined,
      cursor: cursor ?? undefined,
      limit,
    });

    const response = buildPaginatedResponse(
      sales,
      limit,
      (item) => encodeCursor(item.date, item.id)
    );

    return NextResponse.json({
      data: response.data.map(toSaleApi),
      paging: response.paging,
    });
  } catch (error) {
    return toHttpResponse(error);
  }
}