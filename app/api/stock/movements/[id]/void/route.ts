import { NextRequest, NextResponse } from "next/server";

import { requireRole, OWNER } from "@/lib/auth/authorize";
import { prisma } from "@/lib/prisma";
import { toHttpResponse } from "@/lib/response";
import { VoidService } from "@/modules/voids/void.service";
import { validateVoidInput } from "@/modules/voids/void.validation";

type Context = { params: Promise<{ id: string }> };

export async function POST(req: NextRequest, context: Context) {
  try {
    const session = await requireRole(req, [OWNER]);
    const { id } = await context.params;
    let body: unknown;

    try {
      body = await req.json();
    } catch {
      return NextResponse.json({ message: "Invalid JSON body" }, { status: 400 });
    }

    const input = validateVoidInput(body);

    const result = await new VoidService(prisma).voidStockMovement(id, {
      reason: input.reason,
      note: input.note,
      voidedBy: session.user.id,
    });

    return NextResponse.json(result);
  } catch (error) {
    return toHttpResponse(error);
  }
}
