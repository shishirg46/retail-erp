import { NextRequest, NextResponse } from "next/server";

import { requireRole, OWNER } from "@/lib/auth/authorize";
import { prisma } from "@/lib/prisma";
import { toHttpResponse } from "@/lib/response";
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
    const purchases = await new PurchaseService(prisma).listPurchases();

    return NextResponse.json(purchases.map(toPurchaseApi));
  } catch (error) {
    return toHttpResponse(error);
  }
}