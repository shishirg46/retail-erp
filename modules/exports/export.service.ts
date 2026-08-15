// Export orchestration (M20).
//
// Turns an already-computed D7 report into a downloadable response body. The
// report is produced upstream by the report service; this module only picks the
// right serializer (CSV or JSON), wires the streaming body, and provides the
// download headers. It never computes figures itself and never touches the DB.

import type { AnyReport, ExportFormat, ReportName } from "./export.types";
import { exportFilename, reportToDocument } from "./export.definitions";
import { csvChunks } from "./csv";
import { jsonChunks } from "./json";

function toReadableStream(chunks: Generator<Buffer>): ReadableStream<Uint8Array> {
  const iterator = chunks;
  return new ReadableStream<Uint8Array>({
    pull(controller) {
      const { value, done } = iterator.next();
      if (done) {
        controller.close();
        return;
      }
      controller.enqueue(value);
    },
  });
}

// Content-Disposition carries both a plain filename (ASCII fallback) and an
// RFC 5987 filename* for non-ASCII-safe clients; report names are ASCII.
export function contentDisposition(filename: string): string {
  return `attachment; filename="${filename}"; filename*=UTF-8''${encodeURIComponent(filename)}`;
}

export interface ExportStream {
  contentType: string;
  filename: string;
  disposition: string;
  body: ReadableStream<Uint8Array>;
}

export function createExportStream(
  name: ReportName,
  format: ExportFormat,
  report: AnyReport
): ExportStream {
  const filename = exportFilename(name, format);
  const contentType =
    format === "csv" ? "text/csv; charset=utf-8" : "application/json; charset=utf-8";
  const chunks =
    format === "csv" ? csvChunks(reportToDocument(name, report)) : jsonChunks(report);

  return {
    contentType,
    filename,
    disposition: contentDisposition(filename),
    body: toReadableStream(chunks),
  };
}
