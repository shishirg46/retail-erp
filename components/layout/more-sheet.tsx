"use client";

import { NAV_SECTIONS, isVisible } from "@/components/layout/nav-items";
import { NavLink } from "@/components/layout/nav-link";
import type { Role } from "@/lib/auth/authorize";

// Destinations behind the mobile/tablet "More" entry (plan §5.2): the four
// primary tabs live in the tab bar / rail; everything else lives here.
export function MoreSheetContent({ role }: { role: Role }) {
  return (
    <div className="flex flex-col gap-4 overflow-y-auto p-4">
      {NAV_SECTIONS.map((section, index) => {
        const visible = section.items.filter(
          (item) =>
            item.href !== "/" &&
            item.href !== "/sales/new" &&
            item.href !== "/stock/movements" &&
            item.href !== "/customers" &&
            isVisible(item, role)
        );
        if (visible.length === 0) return null;
        return (
          <div key={section.title ?? index} className="space-y-1">
            {section.title ? (
              <p className="px-3 pb-1 text-xs font-medium text-muted-foreground">
                {section.title}
              </p>
            ) : null}
            {visible.map((item) => (
              <NavLink key={item.href} item={item} />
            ))}
          </div>
        );
      })}
    </div>
  );
}
