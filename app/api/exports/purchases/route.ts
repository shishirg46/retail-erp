import { NextRequest } from "next/server";

import { requireRole, OWNER } from "@/lib/auth/authorize";
import { prisma } from "@/lib/prisma";
import { toHttpResponse } from "@/lib/response";
import { createExportStream } from "@/modules/exports/export.service";
import { parseExportFormat } from "@/modules/exports/export.validation";
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
    const format = parseExportFormat(req.nextUrl.searchParams);

    const report = await new ReportService(
      new PrismaReportRepository(prisma)
    ).purchasesReport(range);

    const { contentType, disposition, body } = createExportStream(
      "purchases",
      format,
      report
    );

    return new Response(body, {
      headers: { "Content-Type": contentType, "Content-Disposition": disposition },
    });
  } catch (error) {
    return toHttpResponse(error);
  }
}
