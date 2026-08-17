import { Suspense } from "react";

import { SupplierPayForm } from "@/components/suppliers/supplier-pay-form";

export default async function SupplierPayPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  return (
    <Suspense fallback={null}>
      <SupplierPayForm supplierId={id} />
    </Suspense>
  );
}
