"use client";

import { MoreHorizontal } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";

import { isActivePath } from "@/components/layout/nav-link";
import { MOBILE_TABS } from "@/components/layout/nav-items";
import { MoreSheetContent } from "@/components/layout/more-sheet";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { cn } from "@/lib/utils";
import { CURRENCY_SYMBOL } from "@/lib/constants";
import type { Role } from "@/lib/auth/authorize";

// Tablet left icon rail (768–1199px, 72px, D22.3): the four primary
// destinations with 44px+ targets and a "More" sheet at the bottom.
export function Rail({ role }: { role: Role }) {
  const pathname = usePathname();
  const primary = MOBILE_TABS.filter((tab) => tab.href !== "/#more");

  return (
    <aside className="fixed inset-y-0 left-0 z-30 hidden w-[72px] flex-col border-r bg-background tablet:flex desktop:hidden">
      <div className="flex h-14 shrink-0 items-center justify-center font-heading text-lg font-semibold">
        {CURRENCY_SYMBOL}
      </div>
      <nav aria-label="Main navigation" className="flex flex-1 flex-col items-center gap-1 px-1.5 pt-2">
        {primary.map((tab) => {
          const Icon = tab.icon;
          const isActive = isActivePath(pathname, tab.href);
          return (
            <Link
              key={tab.href}
              href={tab.href}
              aria-current={isActive ? "page" : undefined}
              title={tab.label}
              className={cn(
                "flex min-h-[44px] w-full flex-col items-center justify-center gap-1 rounded-lg text-[10px] font-medium",
                isActive
                  ? "bg-accent text-accent-foreground"
                  : "text-muted-foreground hover:bg-muted hover:text-foreground"
              )}
            >
              <Icon className="size-5" aria-hidden />
              {tab.label}
            </Link>
          );
        })}
      </nav>
      <Sheet>
        <SheetTrigger asChild>
          <Button
            variant="ghost"
            data-testid="more-rail"
            className="mb-3 flex min-h-[44px] flex-col items-center justify-center gap-1 rounded-lg text-[10px] font-medium"
          >
            <MoreHorizontal className="size-5" aria-hidden />
            More
          </Button>
        </SheetTrigger>
        <SheetContent side="bottom" showCloseButton={false} className="pb-safe">
          <SheetTitle className="px-4 pt-2">More</SheetTitle>
          <MoreSheetContent role={role} />
        </SheetContent>
      </Sheet>
    </aside>
  );
}
