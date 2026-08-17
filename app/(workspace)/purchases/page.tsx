import { Suspense } from "react";

import { PurchasesList } from "@/components/purchases/purchases-list";

export default async function PurchasesPage() {
  return (
    <Suspense fallback={null}>
      <PurchasesList />
    </Suspense>
  );
}
