import { Plus, Receipt, ArrowLeftRight } from "lucide-react";
import Link from "next/link";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { requireSession } from "@/lib/auth/session";

// Home — Phase A placeholder (plan §11). The live "Today" snapshot, wallet
// tile, and recent sales arrive with the sales screens (Phase B). Quick
// actions are already the real §11 destinations.
export default async function HomePage() {
  const session = await requireSession();
  const firstName = session.user.name.split(/\s+/)[0] || session.user.name;

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>Welcome back, {firstName}</CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground">
          Today&apos;s summary (sales total, wallet) and recent sales will appear
          here when the sales screens ship in Phase B.
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 gap-3 tablet:grid-cols-3">
        <Link
          href="/sales/new"
          className="min-touch flex items-center gap-3 rounded-xl bg-primary px-4 text-primary-foreground hover:bg-primary-hover"
        >
          <Plus className="size-5 shrink-0" aria-hidden />
          <span className="text-base font-medium">New Sale</span>
        </Link>
        <Link
          href="/customers"
          className="min-touch flex items-center gap-3 rounded-xl border bg-card px-4 text-foreground hover:bg-muted"
        >
          <Receipt className="size-5 shrink-0 text-muted-foreground" aria-hidden />
          <span className="text-base font-medium">Receive payment</span>
        </Link>
        <Link
          href="/stock/adjust"
          className="min-touch flex items-center gap-3 rounded-xl border bg-card px-4 text-foreground hover:bg-muted"
        >
          <ArrowLeftRight className="size-5 shrink-0 text-muted-foreground" aria-hidden />
          <span className="text-base font-medium">Adjust stock</span>
        </Link>
      </div>
    </div>
  );
}
