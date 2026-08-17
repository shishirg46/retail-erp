import { Suspense } from "react";

import { SalesList } from "@/components/sales/sales-list";
import { getSession } from "@/lib/auth/session";

export default async function SalesPage() {
  const session = await getSession();

  return (
    <Suspense fallback={null}>
      <SalesList role={session?.user.role ?? "CASHIER"} />
    </Suspense>
  );
}
