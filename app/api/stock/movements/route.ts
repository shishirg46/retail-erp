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
import { StockService } from "@/modules/stock/stock.service";
import { toStockMovementApi } from "@/modules/stock/stock.repository";

export async function GET(req: NextRequest) {
  try {
    await requireRole(req, [OWNER, CASHIER]);
    const { searchParams } = req.nextUrl;
    const service = new StockService(prisma);

    const hasPaginationParam =
      searchParams.has("cursor") ||
      searchParams.has("limit") ||
      searchParams.has("reason");

    // Preserve existing productId filter behavior for non-paginated path.
    const productId = searchParams.get("productId") ?? undefined;

    if (!hasPaginationParam && !productId) {
      const movements = await service.listMovements();
      return NextResponse.json(movements.map(toStockMovementApi));
    }

    if (!hasPaginationParam && productId) {
      const movements = await service.listMovements(productId);
      return NextResponse.json(movements.map(toStockMovementApi));
    }

    // Paginated path.
    const { cursor, limit } = parsePaginationParams(searchParams);
    const reason = parseStringFilter(searchParams, "reason");

    const movements = await service.listMovementsPaginated({
      productId,
      reason: reason as import("@/modules/stock/stock.types").StockReason | undefined,
      cursor: cursor ?? undefined,
      limit,
    });

    const response = buildPaginatedResponse(
      movements,
      limit,
      (item) => encodeCursor(item.date, item.id)
    );

    return NextResponse.json({
      data: response.data.map(toStockMovementApi),
      paging: response.paging,
    });
  } catch (error) {
    return toHttpResponse(error);
  }
}