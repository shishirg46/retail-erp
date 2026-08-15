import { NextRequest, NextResponse } from "next/server";

import { requireRole, CASHIER, OWNER } from "@/lib/auth/authorize";
import { prisma } from "@/lib/prisma";
import { toHttpResponse } from "@/lib/response";
import { assertUuid } from "@/lib/validate";
import { PrismaSupplierRepository, toSupplierApi } from "@/modules/suppliers/supplier.repository";
import { SupplierService } from "@/modules/suppliers/supplier.service";

type Context = { params: Promise<{ id: string }> };

export async function GET(req: NextRequest, context: Context) {
  try {
    await requireRole(req, [OWNER, CASHIER]);
    const { id } = await context.params;
    assertUuid(id);

    const supplier = await new SupplierService(
      new PrismaSupplierRepository(prisma)
    ).findSupplierById(id);

    if (!supplier) {
      return NextResponse.json(
        { message: "Supplier not found" },
        { status: 404 }
      );
    }

    return NextResponse.json(toSupplierApi(supplier));
  } catch (error) {
    return toHttpResponse(error);
  }
}