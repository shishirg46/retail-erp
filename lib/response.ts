import { NextResponse } from "next/server";

import { AppError } from "./errors";

// Convert any thrown error into a JSON HTTP response.
// AppErrors map to their own status code; anything else is a generic 500
// so raw Prisma/database errors are never leaked to the client.
export function toHttpResponse(error: unknown): NextResponse {
  if (error instanceof AppError) {
    return NextResponse.json(
      { message: error.message },
      { status: error.statusCode }
    );
  }

  const message =
    error instanceof Error ? error.message : "Internal Server Error";

  return NextResponse.json({ message }, { status: 500 });
}