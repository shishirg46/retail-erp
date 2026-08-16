"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ComponentProps } from "react";

import { isActivePath } from "@/components/layout/nav-link";
import { MOBILE_TABS } from "@/components/layout/nav-items";
import { MoreSheetContent } from "@/components/layout/more-sheet";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { cn } from "@/lib/utils";
import type { Role } from "@/lib/auth/authorize";

function TabButton({
  label,
  icon,
  active,
  ...props
}: ComponentProps<typeof Button> & {
  label: string;
  icon: React.ReactNode;
  active?: boolean;
}) {
  return (
    <Button
      variant="ghost"
      aria-current={active ? "page" : undefined}
      className={cn(
        "flex h-full min-h-[44px] flex-col items-center justify-center gap-0.5 rounded-none text-[11px] font-medium",
        active ? "text-foreground" : "text-muted-foreground"
      )}
      {...props}
    >
      {icon}
      {label}
    </Button>
  );
}

// Mobile bottom tab bar (<768px, 64px + safe-area, D22.3). Five tabs
// (Home · Sell · Stock · Customers · More); the More tab opens the bottom
// sheet with the remaining destinations. Every tab is a full 44px+ target.
export function MobileTabBar({ role }: { role: Role }) {
  const pathname = usePathname();

  return (
    <nav
      aria-label="Bottom navigation"
      className="fixed inset-x-0 bottom-0 z-40 border-t bg-background/95 backdrop-blur pb-safe md:hidden"
    >
      <div className="grid h-16 grid-cols-5">
        {MOBILE_TABS.map((tab) => {
          const isMore = tab.href === "/#more";
          const Icon = tab.icon;

          if (isMore) {
            return (
              <Sheet key={tab.href}>
                <TabButton
                  label={tab.label}
                  icon={<Icon aria-hidden />}
                  data-testid="more-tab"
                />
                <SheetContent side="bottom" showCloseButton={false} className="pb-safe">
                  <SheetTitle className="px-4 pt-2">More</SheetTitle>
                  <MoreSheetContent role={role} />
                </SheetContent>
              </Sheet>
            );
          }

          const isActive = isActivePath(pathname, tab.href);
          return (
            <Link
              key={tab.href}
              href={tab.href}
              aria-current={isActive ? "page" : undefined}
              className={cn(
                "flex min-h-[44px] flex-col items-center justify-center gap-0.5 text-[11px] font-medium",
                isActive
                  ? "text-foreground"
                  : "text-muted-foreground hover:text-foreground"
              )}
            >
              <Icon className="size-5" aria-hidden />
              {tab.label}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
