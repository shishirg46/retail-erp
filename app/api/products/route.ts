import { NextRequest, NextResponse } from "next/server";

import { requireRole, CASHIER, OWNER } from "@/lib/auth/authorize";
import { prisma } from "@/lib/prisma";
import { toHttpResponse } from "@/lib/response";
import { PrismaProductRepository, toProductApi } from "@/modules/products/product.repository";
import { validateCreateProductInput } from "@/modules/products/product.validation";

export async function POST(req: NextRequest) {
  try {
    await requireRole(req, [OWNER]);
    let body: unknown;

    try {
      body = await req.json();
    } catch {
      return NextResponse.json({ message: "Invalid JSON body" }, { status: 400 });
    }

    const input = validateCreateProductInput(body);

    const product = await new PrismaProductRepository(prisma).create(input);

    return NextResponse.json(toProductApi(product), { status: 201 });
  } catch (error) {
    return toHttpResponse(error);
  }
}

export async function GET(req: NextRequest) {
  try {
    await requireRole(req, [OWNER, CASHIER]);
    const products = await new PrismaProductRepository(prisma).list();

    return NextResponse.json(products.map(toProductApi));
  } catch (error) {
    return toHttpResponse(error);
  }
}