import { Suspense } from "react";

import { StockMovementsList } from "@/components/stock/stock-movements-list";

export default async function StockMovementsPage() {
  return (
    <Suspense fallback={null}>
      <StockMovementsList />
    </Suspense>
  );
}
