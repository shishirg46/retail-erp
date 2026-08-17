import { Suspense } from "react";

import { ProductsList } from "@/components/products/products-list";
import { getSession } from "@/lib/auth/session";

export default async function ProductsPage() {
  const session = await getSession();

  return (
    <Suspense fallback={null}>
      <ProductsList role={session?.user.role ?? "CASHIER"} />
    </Suspense>
  );
}
