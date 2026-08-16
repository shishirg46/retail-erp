import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { SignInForm } from "@/app/sign-in/sign-in-form";
import { getSession } from "@/lib/auth/session";
import { APP_NAME } from "@/lib/constants";

export const metadata: Metadata = {
  title: "Sign in",
};

// Sign-in screen (plan §10). Already-authenticated users bounce straight to the
// workspace; the RSC session gate in (workspace)/layout.tsx redirects back here
// for unauthenticated visits.
export default async function SignInPage() {
  const session = await getSession();
  if (session) redirect("/");

  return (
    <main className="flex min-h-dvh items-center justify-center px-4 py-8">
      <div className="w-full max-w-[420px]">
        <div className="mb-6 text-center">
          <p className="font-heading text-2xl font-semibold">{APP_NAME}</p>
          <h1 className="mt-1 text-lg font-medium">Welcome back</h1>
          <p className="mt-0.5 text-sm text-muted-foreground">Sign in to the shop</p>
        </div>
        <div className="rounded-xl border bg-card p-5 shadow-sm">
          <SignInForm />
        </div>
      </div>
    </main>
  );
}
