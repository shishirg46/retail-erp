import { describe, expect, it } from "vitest";

import { isVisible, moreDestinations, NAV_SECTIONS, type NavItem } from "@/components/layout/nav-items";

const OWNER_ITEM: NavItem = { href: "/purchases", label: "Purchases", icon: (null as unknown) as NavItem["icon"], roles: ["OWNER"] };
const BOTH_ITEM: NavItem = { href: "/sales", label: "Sales", icon: (null as unknown) as NavItem["icon"] };

describe("isVisible (D9.3 / §5.3 role matrix)", () => {
  it("shows unmarked items to both roles", () => {
    expect(isVisible(BOTH_ITEM, "CASHIER")).toBe(true);
    expect(isVisible(BOTH_ITEM, "OWNER")).toBe(true);
  });

  it("hides OWNER-only items from CASHIER", () => {
    expect(isVisible(OWNER_ITEM, "CASHIER")).toBe(false);
    expect(isVisible(OWNER_ITEM, "OWNER")).toBe(true);
  });
});

describe("moreDestinations", () => {
  it("excludes the four primary mobile tabs (Home/Sell/Stock/Customers)", () => {
    const labels = moreDestinations("CASHIER").map((item) => item.label);
    expect(labels).not.toContain("Home");
    expect(labels).not.toContain("New Sale");
    expect(labels).not.toContain("Stock Movements");
    expect(labels).not.toContain("Customers");
  });

  it("exposes OWNER-only destinations only to OWNER", () => {
    expect(moreDestinations("OWNER").map((item) => item.href)).toContain("/purchases");
    expect(moreDestinations("CASHIER").map((item) => item.href)).not.toContain("/purchases");
    expect(moreDestinations("CASHIER").map((item) => item.href)).not.toContain("/users");
  });

  it("keeps Settings and Reports available to both roles", () => {
    for (const role of ["CASHIER", "OWNER"] as const) {
      const hrefs = moreDestinations(role).map((item) => item.href);
      expect(hrefs).toContain("/settings");
      expect(hrefs).toContain("/reports");
    }
  });
});

describe("NAV_SECTIONS", () => {
  it("covers every §5.1 destination once", () => {
    const hrefs = NAV_SECTIONS.flatMap((section) => section.items).map((item) => item.href);
    for (const href of ["/", "/sales/new", "/sales", "/products", "/stock/movements", "/stock/adjust", "/customers", "/suppliers", "/purchases", "/reports", "/users", "/settings"]) {
      expect(hrefs).toContain(href);
    }
  });
});
