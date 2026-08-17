import { Suspense } from "react";

import { CustomerPayForm } from "@/components/customers/customer-pay-form";

export default async function CustomerPayPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  return (
    <Suspense fallback={null}>
      <CustomerPayForm customerId={id} />
    </Suspense>
  );
}
