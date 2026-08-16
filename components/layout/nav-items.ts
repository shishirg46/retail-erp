// Navigation model (plan §5.2, §5.3, D21.7). One source of truth for every
// breakpoint: mobile bottom tabs, tablet rail, desktop sidebar. `roles` is
// undefined for both-role items.

import {
  ArrowLeftRight,
  BarChart3,
  ClipboardPen,
  Home,
  MoreHorizontal,
  Package,
  Plus,
  Receipt,
  Settings,
  ShoppingCart,
  Truck,
  UserCog,
  Users,
  type LucideIcon,
} from "lucide-react";

import { OWNER, type Role } from "@/lib/auth/roles";

export interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
  roles?: readonly Role[];
}

export interface NavSection {
  title?: string;
  items: NavItem[];
}

// Five mobile tab destinations (§5.2). "More" opens the bottom sheet with the
// remaining destinations.
export const MOBILE_TABS: NavItem[] = [
  { href: "/", label: "Home", icon: Home },
  { href: "/sales/new", label: "Sell", icon: Plus },
  { href: "/stock/movements", label: "Stock", icon: ArrowLeftRight },
  { href: "/customers", label: "Customers", icon: Users },
  { href: "/#more", label: "More", icon: MoreHorizontal },
];

// The full role-filtered destination set, grouped for the desktop sidebar and
// the mobile "More" sheet.
export const NAV_SECTIONS: NavSection[] = [
  {
    items: [{ href: "/", label: "Home", icon: Home }],
  },
  {
    title: "Sell",
    items: [
      { href: "/sales/new", label: "New Sale", icon: Plus },
      { href: "/sales", label: "Sales", icon: Receipt },
    ],
  },
  {
    title: "Stock",
    items: [
      { href: "/products", label: "Products", icon: Package },
      { href: "/stock/movements", label: "Stock Movements", icon: ArrowLeftRight },
      { href: "/stock/adjust", label: "Stock Adjust", icon: ClipboardPen },
    ],
  },
  {
    title: "Customers",
    items: [{ href: "/customers", label: "Customers", icon: Users }],
  },
  {
    title: "Purchasing",
    items: [
      { href: "/suppliers", label: "Suppliers", icon: Truck },
      { href: "/purchases", label: "Purchases", icon: ShoppingCart, roles: [OWNER] },
    ],
  },
  {
    title: "Reports",
    items: [{ href: "/reports", label: "Reports", icon: BarChart3 }],
  },
  {
    title: "Administration",
    items: [
      { href: "/users", label: "Users", icon: UserCog, roles: [OWNER] },
      { href: "/settings", label: "Settings", icon: Settings },
    ],
  },
];

// Destinations that live only in the mobile "More" sheet and the desktop
// sidebar — i.e. everything except the four primary tabs.
export function moreDestinations(role: Role): NavItem[] {
  const flat = NAV_SECTIONS.flatMap((section) => section.items);
  return flat.filter(
    (item) =>
      item.href !== "/" &&
      item.href !== "/sales/new" &&
      item.href !== "/stock/movements" &&
      item.href !== "/customers" &&
      isVisible(item, role)
  );
}

export function isVisible(item: NavItem, role: Role): boolean {
  return item.roles === undefined || item.roles.includes(role);
}

