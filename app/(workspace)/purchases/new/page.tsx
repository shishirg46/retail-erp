import { Suspense } from "react";

import { PurchaseForm } from "@/components/purchases/purchase-form";

export default async function NewPurchasePage() {
  return (
    <Suspense fallback={null}>
      <PurchaseForm />
    </Suspense>
  );
}
