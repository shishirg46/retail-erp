import { Suspense } from "react";

import { PurchaseDetail } from "@/components/purchases/purchase-detail";
import { getSession } from "@/lib/auth/session";

export default async function PurchaseDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const session = await getSession();
  const { id } = await params;

  return (
    <Suspense fallback={null}>
      <PurchaseDetail id={id} role={session?.user.role ?? "CASHIER"} />
    </Suspense>
  );
}
