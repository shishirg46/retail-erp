import { NextRequest, NextResponse } from "next/server";

import { OWNER, requireRole } from "@/lib/auth/authorize";
import { toHttpResponse } from "@/lib/response";
import { assertUserId } from "@/lib/validate";
import { UserService } from "@/modules/users/user.service";

type Context = { params: Promise<{ id: string }> };

export async function POST(req: NextRequest, context: Context) {
  try {
    await requireRole(req, [OWNER]);
    const { id } = await context.params;
    assertUserId(id);
    const user = await new UserService().banUser(req.headers, id);

    return NextResponse.json(user);
  } catch (error) {
    return toHttpResponse(error);
  }
}
