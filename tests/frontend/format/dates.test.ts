import { describe, expect, it } from "vitest";

import {
  parseOffsetMinutes,
  reportPresetRange,
  shopLocalToday,
  shopOffsetMinutesFromRange,
} from "@/lib/format/dates";
import type { ReportRange } from "@/modules/reports/report.types";

// Fixed instant: 2026-08-15T12:00:00.000Z. With +05:45 the shop wall clock is
// 2026-08-15T17:45, so the shop-local date is 2026-08-15.
const NOON_UTC = new Date("2026-08-15T12:00:00.000Z");

describe("parseOffsetMinutes", () => {
  it("parses the +05:45 Asia/Kathmandu offset (D10 echo format)", () => {
    expect(parseOffsetMinutes("2026-08-14T00:00:00.000+05:45")).toBe(345);
  });

  it("parses negative and zero-padded offsets", () => {
    expect(parseOffsetMinutes("2026-08-14T00:00:00.000-08:00")).toBe(-480);
    expect(parseOffsetMinutes("2026-08-14T00:00:00.000-0800")).toBe(-480);
  });

  it("treats Z as UTC", () => {
    expect(parseOffsetMinutes("2026-08-14T00:00:00.000Z")).toBe(0);
  });

  it("returns null for naive date-only echoes", () => {
    expect(parseOffsetMinutes("2026-08-15")).toBeNull();
  });
});

describe("shopOffsetMinutesFromRange", () => {
  it("derives the offset from the range echo's from bound", () => {
    const range: ReportRange = { from: "2026-08-15T00:00:00.000+05:45", to: null };
    expect(shopOffsetMinutesFromRange(range)).toBe(345);
  });

  it("falls back to the to bound when from is absent", () => {
    const range: ReportRange = { from: null, to: "2026-08-15T23:59:59.999+05:45" };
    expect(shopOffsetMinutesFromRange(range)).toBe(345);
  });

  it("returns null when the range carries no instant", () => {
    const range: ReportRange = { from: null, to: null };
    expect(shopOffsetMinutesFromRange(range)).toBeNull();
  });
});

describe("shopLocalToday", () => {
  it("computes today in the shop timezone, not the host timezone (Q4)", () => {
    // 12:00Z + 05:45 = 17:45 in Kathmandu on the same date.
    expect(shopLocalToday(345, NOON_UTC)).toEqual({
      from: "2026-08-15",
      to: "2026-08-15",
    });
  });

  it("crosses midnight correctly at the offset boundary", () => {
    // 2026-08-15T18:16:00Z + 05:45 = 2026-08-16T00:01 local.
    const lateUtc = new Date("2026-08-15T18:16:00.000Z");
    expect(shopLocalToday(345, lateUtc)).toEqual({
      from: "2026-08-16",
      to: "2026-08-16",
    });
  });
});

describe("reportPresetRange", () => {
  const today = { from: "2026-08-15", to: "2026-08-15" };

  it("maps today to the shop-local date", () => {
    expect(reportPresetRange("today", 345, undefined, NOON_UTC)).toEqual(today);
  });

  it("maps last7 to the inclusive seven-day window", () => {
    expect(reportPresetRange("last7", 345, undefined, NOON_UTC)).toEqual({
      from: "2026-08-09",
      to: "2026-08-15",
    });
  });

  it("maps last30 to the inclusive thirty-day window", () => {
    expect(reportPresetRange("last30", 345, undefined, NOON_UTC)).toEqual({
      from: "2026-07-17",
      to: "2026-08-15",
    });
  });

  it("maps thisMonth to the first of the shop-local month", () => {
    expect(reportPresetRange("thisMonth", 345, undefined, NOON_UTC)).toEqual({
      from: "2026-08-01",
      to: "2026-08-15",
    });
  });

  it("passes custom ranges through untouched", () => {
    const custom = { from: "2026-01-01", to: "2026-06-30" };
    expect(reportPresetRange("custom", 345, custom, NOON_UTC)).toEqual(custom);
  });
});
