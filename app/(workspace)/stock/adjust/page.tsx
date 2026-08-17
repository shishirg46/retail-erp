import { Suspense } from "react";

import { StockAdjustForm } from "@/components/stock/stock-adjust-form";

export default async function StockAdjustPage() {
  return (
    <Suspense fallback={null}>
      <StockAdjustForm />
    </Suspense>
  );
}
