import { Suspense } from "react";

import { SupplierForm } from "@/components/suppliers/supplier-form";

export default async function NewSupplierPage() {
  return (
    <Suspense fallback={null}>
      <SupplierForm />
    </Suspense>
  );
}
