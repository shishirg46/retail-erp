import { NextRequest, NextResponse } from "next/server";

import { requireRole, CASHIER, OWNER } from "@/lib/auth/authorize";
import { prisma } from "@/lib/prisma";
import { toHttpResponse } from "@/lib/response";
import { StockService } from "@/modules/stock/stock.service";

export async function GET(req: NextRequest) {
  try {
    await requireRole(req, [OWNER, CASHIER]);
    const productId = req.nextUrl.searchParams.get("productId") ?? undefined;

    const movements = await new StockService(prisma).listMovements(productId);

    return NextResponse.json(movements);
  } catch (error) {
    return toHttpResponse(error);
  }
}