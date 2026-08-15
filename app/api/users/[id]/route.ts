import { NextRequest, NextResponse } from "next/server";

import { OWNER, requireRole } from "@/lib/auth/authorize";
import { toHttpResponse } from "@/lib/response";
import { assertUserId } from "@/lib/validate";
import { UserService } from "@/modules/users/user.service";

type Context = { params: Promise<{ id: string }> };

export async function GET(req: NextRequest, context: Context) {
  try {
    await requireRole(req, [OWNER]);
    const { id } = await context.params;
    assertUserId(id);
    const user = await new UserService().findUserById(req.headers, id);

    return NextResponse.json(user);
  } catch (error) {
    return toHttpResponse(error);
  }
}

export async function PATCH(req: NextRequest, context: Context) {
  try {
    await requireRole(req, [OWNER]);
    const { id } = await context.params;
    assertUserId(id);
    let body: unknown;

    try {
      body = await req.json();
    } catch {
      return NextResponse.json({ message: "Invalid JSON body" }, { status: 400 });
    }

    const user = await new UserService().updateRole(req.headers, id, body);

    return NextResponse.json(user);
  } catch (error) {
    return toHttpResponse(error);
  }
}

export async function DELETE(req: NextRequest, context: Context) {
  try {
    await requireRole(req, [OWNER]);
    const { id } = await context.params;
    assertUserId(id);
    await new UserService().deleteUser(req.headers, id);

    return new NextResponse(null, { status: 204 });
  } catch (error) {
    return toHttpResponse(error);
  }
}
