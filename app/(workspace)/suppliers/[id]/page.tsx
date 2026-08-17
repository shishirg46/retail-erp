import { Suspense } from "react";

import { SupplierDetail } from "@/components/suppliers/supplier-detail";
import { getSession } from "@/lib/auth/session";

export default async function SupplierDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const session = await getSession();
  const { id } = await params;

  return (
    <Suspense fallback={null}>
      <SupplierDetail id={id} role={session?.user.role ?? "CASHIER"} />
    </Suspense>
  );
}
