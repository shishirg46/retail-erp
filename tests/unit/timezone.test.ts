// D10 timezone unit suite — shop-local day boundaries (Vitest).
//
// Proves the naive-as-shop-local conversion, the shop offset math, and the
// shop-local ISO range echo. No DB. The shop default is Asia/Kathmandu
// (+05:45, no DST) and an ERP_TIMEZONE override must be respected.

import { afterEach, describe, expect, it } from "vitest";
import {
  DEFAULT_TIMEZONE,
  formatShopLocal,
  getUtcOffsetMs,
  naiveAsShopLocal,
  shopLocalDayStart,
  shopTimeZone,
} from "../../lib/timezone";

const KATHMANDU_OFFSET_MS = 5 * 3600000 + 45 * 60000; // +05:45

describe("shopTimeZone", () => {
  afterEach(() => {
    delete process.env.ERP_TIMEZONE;
  });

  it("defaults to Asia/Kathmandu when ERP_TIMEZONE is unset", () => {
    delete process.env.ERP_TIMEZONE;
    expect(shopTimeZone()).toBe(DEFAULT_TIMEZONE);
  });

  it("respects an ERP_TIMEZONE override", () => {
    process.env.ERP_TIMEZONE = "Asia/Dhaka";
    expect(shopTimeZone()).toBe("Asia/Dhaka");
  });

  it("rejects an invalid IANA zone loudly", () => {
    process.env.ERP_TIMEZONE = "Not/AZone";
    expect(() => shopTimeZone()).toThrow(/not a valid IANA time zone/);
  });
});

describe("getUtcOffsetMs", () => {
  it("Kathmandu is +05:45 all year", () => {
    const instant = new Date("2026-08-14T00:00:00Z");
    expect(getUtcOffsetMs("Asia/Kathmandu", instant)).toBe(KATHMANDU_OFFSET_MS);
  });

  it("UTC is zero", () => {
    expect(getUtcOffsetMs("UTC", new Date("2026-08-14T00:00:00Z"))).toBe(0);
  });
});

describe("naiveAsShopLocal", () => {
  afterEach(() => {
    delete process.env.ERP_TIMEZONE;
  });

  it("treats naive components as Kathmandu wall clock (D10)", () => {
    delete process.env.ERP_TIMEZONE;
    // 2026-08-14 00:00 in Asia/Kathmandu == 2026-08-13 18:15 UTC.
    expect(naiveAsShopLocal(2026, 8, 14).toISOString()).toBe(
      "2026-08-13T18:15:00.000Z"
    );
  });

  it("keeps the wall clock, not the UTC clock, as the boundary", () => {
    delete process.env.ERP_TIMEZONE;
    // A shop-local afternoon instant must not slide to a different local day.
    const afternoon = naiveAsShopLocal(2026, 8, 14, 15, 30, 0, 0);
    expect(formatShopLocal(afternoon)).toBe("2026-08-14T15:30:00.000+05:45");
  });

  it("respects the ERP_TIMEZONE override for the boundary", () => {
    process.env.ERP_TIMEZONE = "Asia/Dhaka";
    // 2026-08-14 00:00 in Dhaka (+06:00) == 2026-08-13 18:00 UTC.
    expect(naiveAsShopLocal(2026, 8, 14).toISOString()).toBe(
      "2026-08-13T18:00:00.000Z"
    );
  });

  it("shopLocalDayStart is the same boundary", () => {
    delete process.env.ERP_TIMEZONE;
    expect(shopLocalDayStart(2026, 8, 14).toISOString()).toBe(
      naiveAsShopLocal(2026, 8, 14).toISOString()
    );
  });
});

describe("formatShopLocal", () => {
  afterEach(() => {
    delete process.env.ERP_TIMEZONE;
  });

  it("echoes the instant in shop-local terms with the shop offset", () => {
    delete process.env.ERP_TIMEZONE;
    const instant = naiveAsShopLocal(2026, 8, 14);
    expect(formatShopLocal(instant)).toBe("2026-08-14T00:00:00.000+05:45");
  });

  it("the echoed string round-trips to the same instant", () => {
    delete process.env.ERP_TIMEZONE;
    const instant = naiveAsShopLocal(2026, 8, 14, 23, 59, 59, 999);
    const echo = formatShopLocal(instant);
    expect(new Date(echo).toISOString()).toBe(instant.toISOString());
  });

  it("carries the override offset", () => {
    process.env.ERP_TIMEZONE = "UTC";
    const instant = naiveAsShopLocal(2026, 8, 14);
    expect(formatShopLocal(instant)).toBe("2026-08-14T00:00:00.000+00:00");
  });
});
