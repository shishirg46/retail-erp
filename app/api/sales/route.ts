import { NextRequest, NextResponse } from "next/server";

import { prisma } from "@/lib/prisma";
import { toHttpResponse } from "@/lib/response";
import { SaleService } from "@/modules/sales/sale.service";
import { validateCreateSaleInput } from "@/modules/sales/sale.validation";

export async function POST(req: NextRequest) {
  try {
    let body: unknown;

    try {
      body = await req.json();
    } catch {
      return NextResponse.json({ message: "Invalid JSON body" }, { status: 400 });
    }

    const input = validateCreateSaleInput(body);

    const sale = await new SaleService(prisma).createSale(input);

    return NextResponse.json(sale, { status: 201 });
  } catch (error) {
    return toHttpResponse(error);
  }
}

export async function GET() {
  try {
    const sales = await new SaleService(prisma).listSales();

    return NextResponse.json(sales);
  } catch (error) {
    return toHttpResponse(error);
  }
}