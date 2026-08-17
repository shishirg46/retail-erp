import { Suspense } from "react";

import { CustomerDetail } from "@/components/customers/customer-detail";
import { getSession } from "@/lib/auth/session";

export default async function CustomerDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const session = await getSession();
  const { id } = await params;

  return (
    <Suspense fallback={null}>
      <CustomerDetail id={id} role={session?.user.role ?? "CASHIER"} />
    </Suspense>
  );
}
