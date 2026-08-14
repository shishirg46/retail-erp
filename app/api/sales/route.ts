import { NextRequest, NextResponse } from "next/server";

import { requireRole, CASHIER, OWNER } from "@/lib/auth/authorize";
import { prisma } from "@/lib/prisma";
import { toHttpResponse } from "@/lib/response";
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
    const sales = await new SaleService(prisma).listSales();

    return NextResponse.json(sales.map(toSaleApi));
  } catch (error) {
    return toHttpResponse(error);
  }
}