import { Suspense } from "react";

import { CustomersList } from "@/components/customers/customers-list";

export default async function CustomersPage() {
  return (
    <Suspense fallback={null}>
      <CustomersList />
    </Suspense>
  );
}
