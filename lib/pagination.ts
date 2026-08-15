// Cursor-based pagination, search, and filtering (D12 / F-07).
//
// Every list endpoint gains optional pagination via query params. When no
// pagination params are supplied, the existing raw-array response is returned.
// When any pagination param is present, the response is wrapped in
// `{ data: T[], paging: PagingMeta }`.

import { ValidationError } from "./errors";

// ─── Constants ───────────────────────────────────────────────────────────────

export const DEFAULT_PAGE_SIZE = 50;
export const MAX_PAGE_SIZE = 500;

// ─── Types ───────────────────────────────────────────────────────────────────

/** Decoded cursor values: the (date, id) pair that anchors the next page. */
export interface Cursor {
  date: Date;
  id: string;
}

/** Paging metadata returned in the paginated envelope. */
export interface PagingMeta {
  next: string | null;
  hasMore: boolean;
}

/** The paginated response envelope. */
export interface PaginatedResponse<T> {
  data: T[];
  paging: PagingMeta;
}

/** Common pagination query params parsed from the URL. */
export interface PaginationParams {
  cursor: Cursor | null;
  limit: number;
}

// ─── Cursor encoding / decoding ──────────────────────────────────────────────

/**
 * Encode a cursor from a date and id pair.
 * Format: base64url(`date_iso|uuid`)
 */
export function encodeCursor(date: Date, id: string): string {
  const raw = `${date.toISOString()}|${id}`;
  return Buffer.from(raw, "utf8").toString("base64url");
}

/**
 * Decode a base64url cursor string back to a (date, id) pair.
 * Throws ValidationError on invalid format.
 */
export function decodeCursor(cursor: string): Cursor {
  let raw: string;
  try {
    raw = Buffer.from(cursor, "base64url").toString("utf8");
  } catch {
    throw new ValidationError("Invalid cursor");
  }

  const sep = raw.lastIndexOf("|");
  if (sep === -1) {
    throw new ValidationError("Invalid cursor");
  }

  const dateStr = raw.substring(0, sep);
  const id = raw.substring(sep + 1);

  const date = new Date(dateStr);
  if (isNaN(date.getTime())) {
    throw new ValidationError("Invalid cursor");
  }

  if (!id) {
    throw new ValidationError("Invalid cursor");
  }

  return { date, id };
}

// ─── Query param parsing ─────────────────────────────────────────────────────

/**
 * Parse common pagination params (cursor, limit) from URL search params.
 * Throws ValidationError on invalid values.
 */
export function parsePaginationParams(
  searchParams: URLSearchParams
): PaginationParams {
  const cursorStr = searchParams.get("cursor");
  const limitStr = searchParams.get("limit");

  let cursor: Cursor | null = null;
  if (cursorStr) {
    cursor = decodeCursor(cursorStr);
  }

  let limit = DEFAULT_PAGE_SIZE;
  if (limitStr !== null) {
    const parsed = Number(limitStr);
    if (!Number.isInteger(parsed) || parsed < 1) {
      throw new ValidationError("limit must be a positive integer");
    }
    limit = Math.min(parsed, MAX_PAGE_SIZE);
  }

  return { cursor, limit };
}

/**
 * Parse an optional string filter param. Returns undefined if not present.
 */
export function parseStringFilter(
  searchParams: URLSearchParams,
  key: string
): string | undefined {
  return searchParams.get(key) ?? undefined;
}

// ─── Response helpers ────────────────────────────────────────────────────────

/**
 * Build a paginated response envelope.
 * @param data - The page of results (already fetched, at most `limit + 1` items)
 * @param limit - The requested page size
 * @param encodeFn - Function to encode the last item's cursor (date, id) → string
 */
export function buildPaginatedResponse<T>(
  data: T[],
  limit: number,
  encodeFn: (item: T) => string
): PaginatedResponse<T> {
  const hasMore = data.length > limit;
  const page = hasMore ? data.slice(0, limit) : data;

  const next = hasMore ? encodeFn(page[page.length - 1]) : null;

  return {
    data: page,
    paging: { next, hasMore },
  };
}
