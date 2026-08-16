// Global client providers (D22). Wraps the app in the shared QueryClient
// (TanStack Query), the theme context (next-themes, consumed by Sonner), and
// the Sonner toaster. The workspace shell and sign-in page both render inside.

"use client";

import { QueryClientProvider } from "@tanstack/react-query";
import { ThemeProvider } from "next-themes";
import { useState } from "react";

import { Toaster } from "@/components/ui/sonner";
import { createQueryClient } from "@/lib/query-client";

export function Providers({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(() => createQueryClient());

  return (
    <ThemeProvider attribute="class" defaultTheme="light" enableSystem={false} disableTransitionOnChange>
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
      <Toaster richColors position="top-center" />
    </ThemeProvider>
  );
}
