import { NextRequest, NextResponse } from "next/server";

import { prisma } from "@/lib/prisma";
import { toHttpResponse } from "@/lib/response";
import { StockService } from "@/modules/stock/stock.service";

export async function GET(req: NextRequest) {
  try {
    const productId = req.nextUrl.searchParams.get("productId") ?? undefined;

    const movements = await new StockService(prisma).listMovements(productId);

    return NextResponse.json(movements);
  } catch (error) {
    return toHttpResponse(error);
  }
}