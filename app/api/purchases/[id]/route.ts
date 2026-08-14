import { NextRequest, NextResponse } from "next/server";

import { requireRole, OWNER } from "@/lib/auth/authorize";
import { prisma } from "@/lib/prisma";
import { toHttpResponse } from "@/lib/response";
import { PurchaseService } from "@/modules/purchases/purchase.service";
import { toPurchaseApi } from "@/modules/purchases/purchase.mapper";

type Context = { params: Promise<{ id: string }> };

export async function GET(req: NextRequest, context: Context) {
  try {
    await requireRole(req, [OWNER]);
    const { id } = await context.params;

    const purchase = await new PurchaseService(prisma).findPurchaseById(id);

    if (!purchase) {
      return NextResponse.json(
        { message: "Purchase not found" },
        { status: 404 }
      );
    }

    return NextResponse.json(toPurchaseApi(purchase));
  } catch (error) {
    return toHttpResponse(error);
  }
}