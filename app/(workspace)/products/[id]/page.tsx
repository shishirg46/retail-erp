import { Suspense } from "react";

import { ProductDetail } from "@/components/products/product-detail";
import { getSession } from "@/lib/auth/session";

export default async function ProductDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const session = await getSession();
  const { id } = await params;

  return (
    <Suspense fallback={null}>
      <ProductDetail id={id} role={session?.user.role ?? "CASHIER"} />
    </Suspense>
  );
}
