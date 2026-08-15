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
import { PurchaseService } from "@/modules/purchases/purchase.service";
import { toPurchaseApi } from "@/modules/purchases/purchase.mapper";
import { validateCreatePurchaseInput } from "@/modules/purchases/purchase.validation";

export async function POST(req: NextRequest) {
  try {
    await requireRole(req, [OWNER]);
    let body: unknown;

    try {
      body = await req.json();
    } catch {
      return NextResponse.json({ message: "Invalid JSON body" }, { status: 400 });
    }

    const input = validateCreatePurchaseInput(body);

    const purchase = await new PurchaseService(prisma).createPurchase(input);

    return NextResponse.json(toPurchaseApi(purchase), { status: 201 });
  } catch (error) {
    return toHttpResponse(error);
  }
}

export async function GET(req: NextRequest) {
  try {
    await requireRole(req, [OWNER]);
    const { searchParams } = req.nextUrl;
    const service = new PurchaseService(prisma);

    const hasPaginationParam =
      searchParams.has("cursor") ||
      searchParams.has("limit") ||
      searchParams.has("paymentType") ||
      searchParams.has("supplierId");

    if (!hasPaginationParam) {
      const purchases = await service.listPurchases();
      return NextResponse.json(purchases.map(toPurchaseApi));
    }

    const { cursor, limit } = parsePaginationParams(searchParams);
    const paymentType = parseStringFilter(searchParams, "paymentType");
    const supplierId = parseStringFilter(searchParams, "supplierId");

    const purchases = await service.listPurchasesPaginated({
      paymentType: paymentType as import("@/modules/purchases/purchase.types").PurchasePaymentType | undefined,
      supplierId,
      cursor: cursor ?? undefined,
      limit,
    });

    const response = buildPaginatedResponse(
      purchases,
      limit,
      (item) => encodeCursor(item.date, item.id)
    );

    return NextResponse.json({
      data: response.data.map(toPurchaseApi),
      paging: response.paging,
    });
  } catch (error) {
    return toHttpResponse(error);
  }
}