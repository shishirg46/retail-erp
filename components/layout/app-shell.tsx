"use client";

import { usePathname } from "next/navigation";

import { MobileTabBar } from "@/components/layout/mobile-tab-bar";
import { NAV_SECTIONS } from "@/components/layout/nav-items";
import { Rail } from "@/components/layout/rail";
import { Sidebar } from "@/components/layout/sidebar";
import { UserMenu } from "@/components/layout/user-menu";
import type { SessionUser } from "@/lib/auth/session";

function pageTitle(pathname: string): string {
  for (const section of NAV_SECTIONS) {
    for (const item of section.items) {
      if (item.href === pathname) return item.label;
    }
  }
  return "ERP Retail";
}

// Responsive application shell (D22.3): desktop sidebar (≥1200px), tablet icon
// rail (768–1199px), mobile bottom tab bar (<768px) + sticky header with the
// user menu. Renders inside the session-gated (workspace) layout.
export function AppShell({
  user,
  children,
}: {
  user: SessionUser;
  children: React.ReactNode;
}) {
  const pathname = usePathname();

  return (
    <div className="min-h-dvh">
      <Sidebar role={user.role} />
      <Rail role={user.role} />
      <MobileTabBar role={user.role} />

      <div className="flex min-h-dvh flex-col tablet:pl-[72px] desktop:pl-60 max-md:pb-16">
        <header className="sticky top-0 z-20 flex h-14 shrink-0 items-center justify-between border-b bg-background/95 px-4 backdrop-blur tablet:px-6 desktop:px-8">
          <h1 className="font-heading text-base font-semibold">{pageTitle(pathname)}</h1>
          <UserMenu user={user} />
        </header>
        <main className="flex-1 px-4 py-4 tablet:px-6 desktop:px-8">{children}</main>
      </div>
    </div>
  );
}
