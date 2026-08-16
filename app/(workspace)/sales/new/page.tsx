import { Suspense } from "react";

import { NewSale } from "@/components/sales/new-sale";

// New Sale (Phase B.1) — the POS centerpiece. The workspace layout already
// gates this route behind a valid session; both CASHIER and OWNER may sell
// (D9.3, D21.7). useSearchParams needs a Suspense boundary.
export default function NewSalePage() {
  return (
    <Suspense fallback={null}>
      <NewSale />
    </Suspense>
  );
}
