import { NextRequest, NextResponse } from "next/server";

import { requireRole, CASHIER, OWNER } from "@/lib/auth/authorize";
import { prisma } from "@/lib/prisma";
import { toHttpResponse } from "@/lib/response";
import { SaleService } from "@/modules/sales/sale.service";

type Context = { params: Promise<{ id: string }> };

export async function GET(req: NextRequest, context: Context) {
  try {
    await requireRole(req, [OWNER, CASHIER]);
    const { id } = await context.params;

    const sale = await new SaleService(prisma).findSaleById(id);

    if (!sale) {
      return NextResponse.json({ message: "Sale not found" }, { status: 404 });
    }

    return NextResponse.json(sale);
  } catch (error) {
    return toHttpResponse(error);
  }
}