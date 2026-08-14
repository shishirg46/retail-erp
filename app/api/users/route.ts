import { NextRequest, NextResponse } from "next/server";

import { OWNER, requireRole } from "@/lib/auth/authorize";
import { toHttpResponse } from "@/lib/response";
import { UserService } from "@/modules/users/user.service";

export async function GET(req: NextRequest) {
  try {
    await requireRole(req, [OWNER]);
    const users = await new UserService().listUsers(req.headers);

    return NextResponse.json({ users });
  } catch (error) {
    return toHttpResponse(error);
  }
}

export async function POST(req: NextRequest) {
  try {
    await requireRole(req, [OWNER]);
    let body: unknown;

    try {
      body = await req.json();
    } catch {
      return NextResponse.json({ message: "Invalid JSON body" }, { status: 400 });
    }

    const user = await new UserService().createUser(req.headers, body);

    return NextResponse.json(user, { status: 201 });
  } catch (error) {
    return toHttpResponse(error);
  }
}
