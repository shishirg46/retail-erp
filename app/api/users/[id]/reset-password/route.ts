import { NextRequest, NextResponse } from "next/server";

import { OWNER, requireRole } from "@/lib/auth/authorize";
import { toHttpResponse } from "@/lib/response";
import { UserService } from "@/modules/users/user.service";

type Context = { params: Promise<{ id: string }> };

export async function POST(req: NextRequest, context: Context) {
  try {
    await requireRole(req, [OWNER]);
    const { id } = await context.params;
    let body: unknown;

    try {
      body = await req.json();
    } catch {
      return NextResponse.json({ message: "Invalid JSON body" }, { status: 400 });
    }

    await new UserService().resetPassword(req.headers, id, body);

    return new NextResponse(null, { status: 204 });
  } catch (error) {
    return toHttpResponse(error);
  }
}
