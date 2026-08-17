import { Suspense } from "react";

import { SaleDetail } from "@/components/sales/sale-detail";
import { getSession } from "@/lib/auth/session";

export default async function SaleDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const session = await getSession();
  const { id } = await params;

  return (
    <Suspense fallback={null}>
      <SaleDetail id={id} role={session?.user.role ?? "CASHIER"} />
    </Suspense>
  );
}
