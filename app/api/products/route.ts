import { NextRequest, NextResponse } from "next/server";

import { prisma } from "@/lib/prisma";
import { toHttpResponse } from "@/lib/response";
import { PrismaProductRepository } from "@/modules/products/product.repository";
import type { CreateProductInput } from "@/modules/products/product.types";

export async function POST(req: NextRequest) {
  try {
    let body: unknown;

    try {
      body = await req.json();
    } catch {
      return NextResponse.json({ message: "Invalid JSON body" }, { status: 400 });
    }

    const product = await new PrismaProductRepository(prisma).create(
      body as CreateProductInput
    );

    return NextResponse.json(product, { status: 201 });
  } catch (error) {
    return toHttpResponse(error);
  }
}

export async function GET() {
  try {
    const products = await new PrismaProductRepository(prisma).list();

    return NextResponse.json(products);
  } catch (error) {
    return toHttpResponse(error);
  }
}