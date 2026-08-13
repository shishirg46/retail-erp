import { NextRequest, NextResponse } from "next/server";

import { prisma } from "@/lib/prisma";
import { toHttpResponse } from "@/lib/response";
import { PurchaseService } from "@/modules/purchases/purchase.service";

type Context = { params: Promise<{ id: string }> };

export async function GET(req: NextRequest, context: Context) {
  try {
    const { id } = await context.params;

    const purchase = await new PurchaseService(prisma).findPurchaseById(id);

    if (!purchase) {
      return NextResponse.json(
        { message: "Purchase not found" },
        { status: 404 }
      );
    }

    return NextResponse.json(purchase);
  } catch (error) {
    return toHttpResponse(error);
  }
}