"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import type { NavItem } from "@/components/layout/nav-items";
import { cn } from "@/lib/utils";

// Exact-path active state for the shell nav (leaf destinations; nested detail
// pages carry their own back-navigation rather than a persistent highlight).
export function isActivePath(pathname: string, href: string): boolean {
  return pathname === href;
}

export function NavLink({
  item,
  active,
  className,
  iconClassName,
}: {
  item: NavItem;
  active?: boolean;
  className?: string;
  iconClassName?: string;
}) {
  const pathname = usePathname();
  const isActive = active ?? isActivePath(pathname, item.href);
  const Icon = item.icon;

  return (
    <Link
      href={item.href}
      aria-current={isActive ? "page" : undefined}
      className={cn(
        "min-touch flex items-center gap-3 rounded-lg px-3 text-sm font-medium transition-colors",
        isActive
          ? "bg-accent text-accent-foreground"
          : "text-muted-foreground hover:bg-muted hover:text-foreground",
        className
      )}
    >
      <Icon className={cn("size-5 shrink-0", iconClassName)} aria-hidden />
      {item.label}
    </Link>
  );
}
