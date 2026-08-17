import { Suspense } from "react";

import { SuppliersList } from "@/components/suppliers/suppliers-list";
import { getSession } from "@/lib/auth/session";

export default async function SuppliersPage() {
  const session = await getSession();

  return (
    <Suspense fallback={null}>
      <SuppliersList role={session?.user.role ?? "CASHIER"} />
    </Suspense>
  );
}
