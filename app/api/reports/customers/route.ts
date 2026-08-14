import { NextRequest, NextResponse } from "next/server";

import { requireRole, OWNER } from "@/lib/auth/authorize";
import { prisma } from "@/lib/prisma";
import { toHttpResponse } from "@/lib/response";
import { PrismaReportRepository } from "@/modules/reports/report.repository";
import { ReportService } from "@/modules/reports/report.service";
import {
  coerceRangeQuery,
  parseReportDateRange,
} from "@/modules/reports/report.validation";

export async function GET(req: NextRequest) {
  try {
    await requireRole(req, [OWNER]);
    const range = parseReportDateRange(
      coerceRangeQuery(req.nextUrl.searchParams)
    );

    const report = await new ReportService(
      new PrismaReportRepository(prisma)
    ).customersReport(range);

    return NextResponse.json(report);
  } catch (error) {
    return toHttpResponse(error);
  }
}