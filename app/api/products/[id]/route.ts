import { NextRequest, NextResponse } from "next/server";

import { requireRole, CASHIER, OWNER } from "@/lib/auth/authorize";
import { prisma } from "@/lib/prisma";
import { toHttpResponse } from "@/lib/response";
import { assertUuid } from "@/lib/validate";
import { PrismaProductRepository, toProductApi } from "@/modules/products/product.repository";

type Context = { params: Promise<{ id: string }> };

export async function GET(req: NextRequest, context: Context) {
  try {
    await requireRole(req, [OWNER, CASHIER]);
    const { id } = await context.params;
    assertUuid(id);

    const product = await new PrismaProductRepository(prisma).findById(id);

    if (!product) {
      return NextResponse.json({ message: "Product not found" }, { status: 404 });
    }

    return NextResponse.json(toProductApi(product));
  } catch (error) {
    return toHttpResponse(error);
  }
}