import { NextRequest, NextResponse } from "next/server";

import { prisma } from "@/lib/prisma";
import { toHttpResponse } from "@/lib/response";
import { PrismaSupplierRepository } from "@/modules/suppliers/supplier.repository";
import { SupplierService } from "@/modules/suppliers/supplier.service";

type Context = { params: Promise<{ id: string }> };

export async function GET(req: NextRequest, context: Context) {
  try {
    const { id } = await context.params;

    const supplier = await new SupplierService(
      new PrismaSupplierRepository(prisma)
    ).findSupplierById(id);

    if (!supplier) {
      return NextResponse.json(
        { message: "Supplier not found" },
        { status: 404 }
      );
    }

    return NextResponse.json(supplier);
  } catch (error) {
    return toHttpResponse(error);
  }
}