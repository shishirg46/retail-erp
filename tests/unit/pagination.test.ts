// Unit tests for lib/pagination.ts (D12 cursor-based pagination).

import { describe, expect, it } from "vitest";
import {
  encodeCursor,
  decodeCursor,
  parsePaginationParams,
  parseStringFilter,
  buildPaginatedResponse,
  DEFAULT_PAGE_SIZE,
  MAX_PAGE_SIZE,
} from "../../lib/pagination";
import { ValidationError } from "../../lib/errors";

// ─── Cursor encoding / decoding ──────────────────────────────────────────────

describe("cursor encode/decode", () => {
  it("round-trips a date + id pair", () => {
    const date = new Date("2026-08-15T10:30:00.000Z");
    const id = "550e8400-e29b-41d4-a716-446655440000";
    const cursor = encodeCursor(date, id);
    const decoded = decodeCursor(cursor);

    expect(decoded.date.toISOString()).toBe(date.toISOString());
    expect(decoded.id).toBe(id);
  });

  it("produces a base64url string (no +, /, or = padding)", () => {
    const cursor = encodeCursor(new Date(), "abc-123");
    expect(cursor).not.toContain("+");
    expect(cursor).not.toContain("/");
    expect(cursor).not.toContain("=");
  });

  it("handles identical timestamps with different IDs (tiebreaker)", () => {
    const date = new Date("2026-08-15T10:30:00.000Z");
    const id1 = "aaaa-1111";
    const id2 = "aaaa-2222";

    const c1 = encodeCursor(date, id1);
    const c2 = encodeCursor(date, id2);

    expect(c1).not.toBe(c2);

    const d1 = decodeCursor(c1);
    const d2 = decodeCursor(c2);

    expect(d1.date.toISOString()).toBe(d2.date.toISOString());
    expect(d1.id).toBe(id1);
    expect(d2.id).toBe(id2);
  });

  it("rejects non-base64url garbage", () => {
    expect(() => decodeCursor("!!!invalid!!!")).toThrow(ValidationError);
    expect(() => decodeCursor("!!!invalid!!!")).toThrow("Invalid cursor");
  });

  it("rejects base64url that decodes to string without pipe separator", () => {
    const noPipe = Buffer.from("2026-08-15T10:30:00.000Z-nopipe", "utf8").toString(
      "base64url"
    );
    expect(() => decodeCursor(noPipe)).toThrow("Invalid cursor");
  });

  it("rejects cursor with invalid date", () => {
    const badDate = Buffer.from("not-a-date|uuid-here", "utf8").toString(
      "base64url"
    );
    expect(() => decodeCursor(badDate)).toThrow("Invalid cursor");
  });

  it("rejects cursor with empty id", () => {
    const emptyId = Buffer.from("2026-08-15T10:30:00.000Z|", "utf8").toString(
      "base64url"
    );
    expect(() => decodeCursor(emptyId)).toThrow("Invalid cursor");
  });
});

// ─── parsePaginationParams ───────────────────────────────────────────────────

describe("parsePaginationParams", () => {
  it("returns defaults when no params present", () => {
    const sp = new URLSearchParams();
    const result = parsePaginationParams(sp);

    expect(result.cursor).toBeNull();
    expect(result.limit).toBe(DEFAULT_PAGE_SIZE);
  });

  it("parses a valid cursor", () => {
    const date = new Date("2026-08-15T10:30:00.000Z");
    const id = "test-id-123";
    const sp = new URLSearchParams({ cursor: encodeCursor(date, id) });

    const result = parsePaginationParams(sp);
    expect(result.cursor).not.toBeNull();
    expect(result.cursor!.date.toISOString()).toBe(date.toISOString());
    expect(result.cursor!.id).toBe(id);
  });

  it("parses a valid limit", () => {
    const sp = new URLSearchParams({ limit: "25" });
    expect(parsePaginationParams(sp).limit).toBe(25);
  });

  it("clamps limit to MAX_PAGE_SIZE", () => {
    const sp = new URLSearchParams({ limit: "9999" });
    expect(parsePaginationParams(sp).limit).toBe(MAX_PAGE_SIZE);
  });

  it("rejects non-integer limit", () => {
    const sp = new URLSearchParams({ limit: "abc" });
    expect(() => parsePaginationParams(sp)).toThrow(ValidationError);
    expect(() => parsePaginationParams(sp)).toThrow(
      "limit must be a positive integer"
    );
  });

  it("rejects zero limit", () => {
    const sp = new URLSearchParams({ limit: "0" });
    expect(() => parsePaginationParams(sp)).toThrow(ValidationError);
  });

  it("rejects negative limit", () => {
    const sp = new URLSearchParams({ limit: "-5" });
    expect(() => parsePaginationParams(sp)).toThrow(ValidationError);
  });

  it("rejects invalid cursor string", () => {
    const sp = new URLSearchParams({ cursor: "not-valid" });
    expect(() => parsePaginationParams(sp)).toThrow("Invalid cursor");
  });
});

// ─── parseStringFilter ───────────────────────────────────────────────────────

describe("parseStringFilter", () => {
  it("returns undefined when param not present", () => {
    const sp = new URLSearchParams();
    expect(parseStringFilter(sp, "search")).toBeUndefined();
  });

  it("returns the value when present", () => {
    const sp = new URLSearchParams({ search: "milk" });
    expect(parseStringFilter(sp, "search")).toBe("milk");
  });
});

// ─── buildPaginatedResponse ──────────────────────────────────────────────────

describe("buildPaginatedResponse", () => {
  interface Item {
    date: Date;
    id: string;
  }

  const encodeItem = (item: Item) => encodeCursor(item.date, item.id);

  it("returns hasMore=false and next=null when data fits in limit", () => {
    const items: Item[] = [
      { date: new Date("2026-08-15T10:00:00Z"), id: "a" },
      { date: new Date("2026-08-15T09:00:00Z"), id: "b" },
    ];

    const result = buildPaginatedResponse(items, 50, encodeItem);

    expect(result.data).toHaveLength(2);
    expect(result.paging.hasMore).toBe(false);
    expect(result.paging.next).toBeNull();
  });

  it("returns hasMore=true and trims to limit when data exceeds limit", () => {
    const items: Item[] = [];
    for (let i = 0; i < 51; i++) {
      items.push({
        date: new Date(`2026-08-15T${String(10 - (i % 11)).padStart(2, "0")}:00:00Z`),
        id: `item-${i}`,
      });
    }

    const result = buildPaginatedResponse(items, 50, encodeItem);

    expect(result.data).toHaveLength(50);
    expect(result.paging.hasMore).toBe(true);
    expect(result.paging.next).not.toBeNull();

    // Decode the next cursor — it should point to the 50th item (index 49)
    const decoded = decodeCursor(result.paging.next!);
    expect(decoded.id).toBe("item-49");
  });

  it("returns empty data with hasMore=false for zero items", () => {
    const result = buildPaginatedResponse([], 50, encodeItem);

    expect(result.data).toHaveLength(0);
    expect(result.paging.hasMore).toBe(false);
    expect(result.paging.next).toBeNull();
  });

  it("returns exactly limit items with hasMore=false when data.length === limit", () => {
    const items: Item[] = Array.from({ length: 50 }, (_, i) => ({
      date: new Date(`2026-08-15T10:00:00Z`),
      id: `item-${i}`,
    }));

    const result = buildPaginatedResponse(items, 50, encodeItem);

    expect(result.data).toHaveLength(50);
    expect(result.paging.hasMore).toBe(false);
    expect(result.paging.next).toBeNull();
  });
});

// ─── Constants ───────────────────────────────────────────────────────────────

describe("pagination constants", () => {
  it("DEFAULT_PAGE_SIZE is 50", () => {
    expect(DEFAULT_PAGE_SIZE).toBe(50);
  });

  it("MAX_PAGE_SIZE is 500", () => {
    expect(MAX_PAGE_SIZE).toBe(500);
  });
});
