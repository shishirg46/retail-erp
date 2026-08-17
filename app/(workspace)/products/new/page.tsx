import { Suspense } from "react";

import { ProductForm } from "@/components/products/product-form";
import { getSession } from "@/lib/auth/session";

export default async function NewProductPage() {
  const session = await getSession();

  return (
    <Suspense fallback={null}>
      <ProductForm role={session?.user.role ?? "CASHIER"} />
    </Suspense>
  );
}
