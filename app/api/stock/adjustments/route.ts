import { NextRequest, NextResponse } from "next/server";

import { requireRole, CASHIER, OWNER } from "@/lib/auth/authorize";
import { prisma } from "@/lib/prisma";
import { toHttpResponse } from "@/lib/response";
import { StockService } from "@/modules/stock/stock.service";
import { toAdjustStockResultApi } from "@/modules/stock/stock.repository";
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

    // D27: OPENING stock reason requires OWNER authorization.
    // DAMAGE and CORRECTION allow OWNER or CASHIER (D6).
    if (input.reason === "OPENING") {
      await requireRole(req, [OWNER]);
    } else {
      await requireRole(req, [OWNER, CASHIER]);
    }

    const result = await new StockService(prisma).adjustStock(input);

    return NextResponse.json(toAdjustStockResultApi(result), { status: 201 });
  } catch (error) {
    return toHttpResponse(error);
  }
}