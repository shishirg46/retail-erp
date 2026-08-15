import { NextRequest, NextResponse } from "next/server";

import { requireRole, CASHIER, OWNER } from "@/lib/auth/authorize";
import { prisma } from "@/lib/prisma";
import { toHttpResponse } from "@/lib/response";
import {
  parsePaginationParams,
  parseStringFilter,
  encodeCursor,
  buildPaginatedResponse,
} from "@/lib/pagination";
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
    const { searchParams } = req.nextUrl;

    // Check if any pagination/filter param is present.
    const hasPaginationParam =
      searchParams.has("cursor") ||
      searchParams.has("limit") ||
      searchParams.has("search") ||
      searchParams.has("category");

    const repository = new PrismaProductRepository(prisma);

    if (!hasPaginationParam) {
      // Option A: no params → existing raw-array response.
      const products = await repository.list();
      return NextResponse.json(products.map(toProductApi));
    }

    // Paginated path.
    const { cursor, limit } = parsePaginationParams(searchParams);
    const search = parseStringFilter(searchParams, "search");
    const category = parseStringFilter(searchParams, "category");

    const products = await repository.listPaginated({
      search,
      category,
      cursor: cursor ?? undefined,
      limit,
    });

    const response = buildPaginatedResponse(
      products,
      limit,
      (item) => encodeCursor(item.createdAt, item.id)
    );

    return NextResponse.json({
      data: response.data.map(toProductApi),
      paging: response.paging,
    });
  } catch (error) {
    return toHttpResponse(error);
  }
}