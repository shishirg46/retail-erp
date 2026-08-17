import { NextRequest, NextResponse } from "next/server";

import { requireRole, OWNER } from "@/lib/auth/authorize";
import { prisma } from "@/lib/prisma";
import { toHttpResponse } from "@/lib/response";
import { PrismaSettingsRepository } from "@/modules/settings/settings.repository";
import { toSettingsApi } from "@/modules/settings/settings.repository";
import { SettingsService } from "@/modules/settings/settings.service";
import { validateUpdateSettingsInput } from "@/modules/settings/settings.validation";

export async function GET(req: NextRequest) {
  try {
    await requireRole(req, [OWNER]);

    const settings = await new SettingsService(
      new PrismaSettingsRepository(prisma)
    ).getSettings();

    return NextResponse.json(toSettingsApi(settings));
  } catch (error) {
    return toHttpResponse(error);
  }
}

export async function PATCH(req: NextRequest) {
  try {
    await requireRole(req, [OWNER]);

    let body: unknown;

    try {
      body = await req.json();
    } catch {
      return NextResponse.json({ message: "Invalid JSON body" }, { status: 400 });
    }

    const input = validateUpdateSettingsInput(body);

    const settings = await new SettingsService(
      new PrismaSettingsRepository(prisma)
    ).updateSettings(input);

    return NextResponse.json(toSettingsApi(settings));
  } catch (error) {
    return toHttpResponse(error);
  }
}
