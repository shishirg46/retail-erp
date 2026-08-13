import { NextRequest, NextResponse } from "next/server";

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
    const range = parseReportDateRange(
      coerceRangeQuery(req.nextUrl.searchParams)
    );

    const report = await new ReportService(
      new PrismaReportRepository(prisma)
    ).suppliersReport(range);

    return NextResponse.json(report);
  } catch (error) {
    return toHttpResponse(error);
  }
}