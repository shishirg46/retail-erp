import { NextRequest, NextResponse } from "next/server";

import { prisma } from "@/lib/prisma";
import { toHttpResponse } from "@/lib/response";
import { StockService } from "@/modules/stock/stock.service";
import { validateAdjustStockInput } from "@/modules/stock/stock.validation";

export async function POST(req: NextRequest) {
  try {
    let body: unknown;

    try {
      body = await req.json();
    } catch {
      return NextResponse.json({ message: "Invalid JSON body" }, { status: 400 });
    }

    const input = validateAdjustStockInput(body);

    const result = await new StockService(prisma).adjustStock(input);

    return NextResponse.json(result, { status: 201 });
  } catch (error) {
    return toHttpResponse(error);
  }
}