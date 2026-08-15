import { NextRequest, NextResponse } from "next/server";

import { requireRole, CASHIER, OWNER } from "@/lib/auth/authorize";
import { prisma } from "@/lib/prisma";
import { toHttpResponse } from "@/lib/response";
import { assertUuid } from "@/lib/validate";
import { SaleService } from "@/modules/sales/sale.service";
import { toSaleApi } from "@/modules/sales/sale.mapper";

type Context = { params: Promise<{ id: string }> };

export async function GET(req: NextRequest, context: Context) {
  try {
    await requireRole(req, [OWNER, CASHIER]);
    const { id } = await context.params;
    assertUuid(id);

    const sale = await new SaleService(prisma).findSaleById(id);

    if (!sale) {
      return NextResponse.json({ message: "Sale not found" }, { status: 404 });
    }

    return NextResponse.json(toSaleApi(sale));
  } catch (error) {
    return toHttpResponse(error);
  }
}