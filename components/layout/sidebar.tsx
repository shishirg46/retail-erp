"use client";

import { NAV_SECTIONS, isVisible } from "@/components/layout/nav-items";
import { NavLink } from "@/components/layout/nav-link";
import { cn } from "@/lib/utils";
import type { Role } from "@/lib/auth/authorize";

// Desktop persistent sidebar (≥1200px, 240px, D22.3). All destinations,
// role-filtered, grouped by section (plan §5.2/§5.3).
export function Sidebar({ role, className }: { role: Role; className?: string }) {
  return (
    <aside
      className={cn(
        "fixed inset-y-0 left-0 z-30 hidden w-60 flex-col border-r bg-sidebar text-sidebar-foreground desktop:flex",
        className
      )}
    >
      <div className="flex h-14 shrink-0 items-center px-4 font-heading text-base font-semibold">
        ERP Retail
      </div>
      <nav className="flex-1 space-y-5 overflow-y-auto px-3 pb-6" aria-label="Main navigation">
        {NAV_SECTIONS.map((section, index) => {
          const visible = section.items.filter((item) => isVisible(item, role));
          if (visible.length === 0) return null;
          return (
            <div key={section.title ?? index} className="space-y-1">
              {section.title ? (
                <p className="px-3 pt-3 text-xs font-medium text-muted-foreground">
                  {section.title}
                </p>
              ) : null}
              {visible.map((item) => (
                <NavLink key={item.href} item={item} />
              ))}
            </div>
          );
        })}
      </nav>
    </aside>
  );
}
