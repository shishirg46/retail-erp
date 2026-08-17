import { Suspense } from "react";

import { CustomerForm } from "@/components/customers/customer-form";

export default async function NewCustomerPage() {
  return (
    <Suspense fallback={null}>
      <CustomerForm />
    </Suspense>
  );
}
