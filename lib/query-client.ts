// One shared QueryClient for the app (D22.2). Conservative POS defaults:
// no refetch on window focus, a single silent retry for network blips, and a
// short stale time so mutating screens never show outdated totals.

import { QueryClient } from "@tanstack/react-query";

export function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 30_000,
        refetchOnWindowFocus: false,
        retry: 1,
      },
      mutations: {
        retry: 0,
      },
    },
  });
}
