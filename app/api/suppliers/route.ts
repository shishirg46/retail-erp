import { NextRequest, NextResponse } from "next/server";

import { requireRole, CASHIER, OWNER } from "@/lib/auth/authorize";
import { prisma } from "@/lib/prisma";
import { toHttpResponse } from "@/lib/response";
import { PrismaSupplierRepository, toSupplierApi } from "@/modules/suppliers/supplier.repository";
import { SupplierService } from "@/modules/suppliers/supplier.service";
import { validateCreateSupplierInput } from "@/modules/suppliers/supplier.validation";

export async function POST(req: NextRequest) {
  try {
    await requireRole(req, [OWNER]);
    let body: unknown;

    try {
      body = await req.json();
    } catch {
      return NextResponse.json({ message: "Invalid JSON body" }, { status: 400 });
    }

    const input = validateCreateSupplierInput(body);

    const supplier = await new SupplierService(
      new PrismaSupplierRepository(prisma)
    ).createSupplier(input);

    return NextResponse.json(toSupplierApi(supplier), { status: 201 });
  } catch (error) {
    return toHttpResponse(error);
  }
}

export async function GET(req: NextRequest) {
  try {
    await requireRole(req, [OWNER, CASHIER]);
    const suppliers = await new SupplierService(
      new PrismaSupplierRepository(prisma)
    ).listSuppliers();

    return NextResponse.json(suppliers.map(toSupplierApi));
  } catch (error) {
    return toHttpResponse(error);
  }
}